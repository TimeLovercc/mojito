"""Persistent research orchestration; scientific judgments are made by workers, not the hub."""
import hashlib
import json
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from . import auth, db
from .idea_models import (
    Automation, AutomationEdit, AutomationInput, CheckpointInput, FinishInput, Idea, IdeaEdit, IdeaInput,
    IdeaSyncInput, IdeaSyncReceipt, Lab, LeaseInput, LeaseToken, Run, RunInput, SeedEdit,
)

router = APIRouter()
TABLES = {'seed': 'idea_seeds', 'idea': 'research_ideas', 'run': 'research_runs', 'automation': 'research_automations'}
TERMINAL = {'completed', 'needs_input', 'failed', 'cancelled'}
LEASE_SECONDS = 120


def records(kind):
    return [json.loads(row['body']) for row in db.all_(f'SELECT body FROM {TABLES[kind]} ORDER BY rowid DESC')]


def read(kind, key):
    row = db.one(f'SELECT body FROM {TABLES[kind]} WHERE id = ?', key)
    if row is None:
        raise HTTPException(404, f'{kind} {key} does not exist')
    return json.loads(row['body'])


def save(kind, value):
    db.conn.execute(f'INSERT INTO {TABLES[kind]} (id, body) VALUES (?, ?) '
                    'ON CONFLICT(id) DO UPDATE SET body = excluded.body',
                    (value['id'], json.dumps(value, ensure_ascii=False)))


def seed_identity(raw):
    """A research-map inbox entry (as stored) → (identity, seed id). api.md Idea Lab 收件箱身份唯一:
    kind (legacy entries are ideas), at in UTC to the second, source. Existing seed ids depend on
    this exact algorithm."""
    kind = raw['kind'] if 'kind' in raw else 'idea'  # documented legacy inbox format
    # Normalized timestamps prevent Z/+00:00 differences creating a second seed.
    identity = [kind, db.ts(db.parse(raw['at'])), raw['source']]
    return identity, hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()[:24]


def check_inbox(inbox):
    """PUT /research-map: 422 when two inbox entries share a seed identity, so sync_seeds never
    meets a map it cannot turn into seeds."""
    seen = {}
    for raw in inbox:
        identity, key = seed_identity(raw)
        if key in seen:
            raise HTTPException(422, f'inbox entries share the seed identity {identity} (kind, at, source): '
                                     f'{seen[key]["text"][:40]!r} and {raw["text"][:40]!r}; '
                                     'give each a different at or source')
        seen[key] = raw


def sync_seeds():
    row = db.one('SELECT body FROM research_map WHERE id = 1')
    if row is None:
        return
    previous = {s['id']: s for s in records('seed')}
    current = {}
    for raw in json.loads(row['body'])['inbox']:
        identity, key = seed_identity(raw)
        kind = identity[0]
        snapshot = {**raw, 'kind': kind}
        if key in current and current[key]['snapshot'] != snapshot:
            raise HTTPException(409, f'inbox entries share kind/time/source identity: {identity}')
        if key in previous:
            seed = previous[key]
            seed.update(kind=kind, text=raw['text'], source=raw['source'], at=raw['at'], snapshot=snapshot, present=True)
        else:
            seed = dict(id=key, kind=kind, text=raw['text'], source=raw['source'], at=raw['at'],
                        snapshot=snapshot, reason='', idea_ids=[], present=True, last_explored_at=None)
        current[key] = seed
    with db.conn:
        for key, seed in previous.items():
            if key not in current:
                seed['present'] = False
                save('seed', seed)
        for seed in current.values():
            save('seed', seed)


def check_refs(seed_ids, idea_ids):
    if len(seed_ids) != len(set(seed_ids)) or len(idea_ids) != len(set(idea_ids)):
        raise HTTPException(422, 'seed_ids and idea_ids must not contain duplicates')
    for key in seed_ids:
        read('seed', key)
    for key in idea_ids:
        read('idea', key)


def associate(idea):
    for seed in records('seed'):
        linked = [key for key in seed['idea_ids'] if key != idea['id']]
        if seed['id'] in idea['seed_ids']:
            linked.append(idea['id'])
        if linked != seed['idea_ids']:
            seed['idea_ids'] = linked
            save('seed', seed)


def write_idea(content, existing_id, revision):
    check_refs(content['seed_ids'], [])
    now = db.ts(db.now())
    if existing_id is None:
        value = {**content, 'id': str(uuid.uuid4()), 'revision': 1, 'created_at': now, 'updated_at': now}
    else:
        old = read('idea', existing_id)
        if old['revision'] != revision:
            raise HTTPException(409, f'idea {existing_id} revision changed: expected {revision}, actual {old["revision"]}')
        value = {**content, 'id': existing_id, 'revision': revision + 1,
                 'created_at': old['created_at'], 'updated_at': now}
    Idea.model_validate(value)
    save('idea', value)
    associate(value)
    return value


def public_run(value, role):
    return value if role == 'worker' else {**value, 'lease_token': None}


@router.get('/idea-lab', response_model=Lab)
async def lab(role: str = Depends(auth.idea_readers)):
    sync_seeds()
    return dict(seeds=records('seed'), ideas=records('idea'),
                runs=[public_run(r, role) for r in records('run')], automations=records('automation'))


@router.put('/idea-lab/seeds/{key}', dependencies=[Depends(auth.app_write)])
async def edit_seed(key: str, body: SeedEdit):
    with db.conn:
        value = read('seed', key)
        value['reason'] = body.reason
        save('seed', value)
    return value


@router.get('/idea-lab/ideas/{key}', response_model=Idea, dependencies=[Depends(auth.idea_readers)])
async def get_idea(key: str):
    return read('idea', key)


@router.post('/idea-lab/ideas', response_model=Idea, dependencies=[Depends(auth.app_write)])
async def create_idea(body: IdeaInput):
    with db.conn:
        return write_idea(body.model_dump(mode='json'), None, None)


@router.put('/idea-lab/ideas/{key}', response_model=Idea, dependencies=[Depends(auth.app_write)])
async def edit_idea(key: str, body: IdeaEdit):
    with db.conn:
        return write_idea(body.model_dump(mode='json', exclude={'revision'}), key, body.revision)


def preserve_history(old: Idea, content: IdeaInput):
    evidence = {entry.id: entry for entry in content.evidence}
    for entry in old.evidence:
        if entry.id not in evidence or evidence[entry.id] != entry:
            raise HTTPException(422, f'existing evidence {entry.id} must be retained unchanged')
    remaining = iter(content.changes)
    for index, change in enumerate(old.changes):
        if not any(candidate == change for candidate in remaining):
            raise HTTPException(422, f'existing change at index {index} must be retained unchanged in relative order')


@router.post('/idea-lab/sync', response_model=IdeaSyncReceipt, dependencies=[Depends(auth.idea_sync_writers)])
async def sync_idea(body: IdeaSyncInput):
    with db.conn:
        prior = db.one('SELECT request, receipt FROM idea_sync_receipts WHERE operation_id = ?', body.operation_id)
        if prior is not None:
            if IdeaSyncInput.model_validate(json.loads(prior['request'])) != body:
                raise HTTPException(409, f'operation_id {body.operation_id} was used with a different request')
            return json.loads(prior['receipt'])
        if body.existing_id is not None:
            old = Idea.model_validate(read('idea', body.existing_id))
            if old.revision != body.revision:
                raise HTTPException(409, f'idea {old.id} revision changed: expected {body.revision}, actual {old.revision}')
            preserve_history(old, body.content)
        idea = write_idea(body.content.model_dump(mode='json'), body.existing_id, body.revision)
        receipt = {'operation_id': body.operation_id, 'idea': idea}
        db.conn.execute('INSERT INTO idea_sync_receipts (operation_id, request, receipt) VALUES (?, ?, ?)',
                        (body.operation_id, body.model_dump_json(), json.dumps(receipt, ensure_ascii=False)))
    return receipt


@router.get('/idea-lab/sync/{operation_id}', response_model=IdeaSyncReceipt,
            dependencies=[Depends(auth.idea_readers)])
async def get_sync_receipt(operation_id: str):
    row = db.one('SELECT receipt FROM idea_sync_receipts WHERE operation_id = ?', operation_id)
    if row is None:
        raise HTTPException(404, f'sync operation {operation_id} has not committed')
    return json.loads(row['receipt'])


def enqueue(body, automation_id):
    values = body.model_dump(mode='json')
    for old in records('run'):
        if old['idempotency_key'] == body.idempotency_key:
            if any(old[key] != value for key, value in values.items()):
                raise HTTPException(409, 'idempotency_key was used with a different request')
            return old
    check_refs(body.seed_ids, body.idea_ids)
    key = str(uuid.uuid4())
    now = db.now()
    job = db.insert_job(kind='research_run', runner='mac', record_id=None, payload={'run_id': key}, at=now)
    value = dict(**values, id=key, job_id=job.id, status='queued', created_at=db.ts(now),
                 started_at=None, finished_at=None, error=None, summary='',
                 idea_revisions={key: read('idea', key)['revision'] for key in body.idea_ids},
                 output_idea_ids=[], artifacts=[], lease_token=None, lease_until=None,
                 automation_id=automation_id)
    save('run', value)
    return value


@router.post('/idea-lab/runs', response_model=Run, dependencies=[Depends(auth.app_write)])
async def create_run(body: RunInput):
    sync_seeds()
    with db.conn:
        return public_run(enqueue(body, None), 'app')


@router.get('/idea-lab/runs/{key}', response_model=Run)
async def get_run(key: str, role: str = Depends(auth.app_read)):
    return public_run(read('run', key), role)


def end(value, status, summary, error):
    value.update(status=status, summary=summary, error=error, finished_at=db.ts(db.now()), lease_until=None)
    save('run', value)
    db.conn.execute('UPDATE jobs SET status = ?, finished_at = ?, error = ? WHERE id = ?',
                    ('failed' if status == 'failed' else 'done', value['finished_at'], error, value['job_id']))


@router.post('/idea-lab/runs/{key}/cancel', response_model=Run, dependencies=[Depends(auth.app_write)])
async def cancel_run(key: str):
    with db.conn:
        value = read('run', key)
        if value['status'] not in TERMINAL:
            end(value, 'cancelled', '用户取消；执行器将在下一次检查时终止此任务的进程组。', None)
    return public_run(value, 'app')


@router.post('/idea-lab/automations', response_model=Automation, dependencies=[Depends(auth.app_write)])
async def create_automation(body: AutomationInput):
    sync_seeds()
    values = body.model_dump(mode='json')
    with db.conn:
        for old in records('automation'):
            if old['idempotency_key'] == body.idempotency_key:
                if any(old[k] != v for k, v in values.items() if k != 'enabled'):
                    raise HTTPException(409, 'automation idempotency_key reused with different request')
                return old
        check_refs(body.run.seed_ids, body.run.idea_ids)
        value = dict(**values, id=str(uuid.uuid4()), runs_started=0,
                     next_at=db.ts(db.now() + timedelta(minutes=body.interval_minutes)),
                     last_seed_ids=[s['id'] for s in records('seed') if s['present']],
                     state='active' if body.enabled else 'disabled')
        save('automation', value)
    return value


@router.put('/idea-lab/automations/{key}', response_model=Automation, dependencies=[Depends(auth.app_write)])
async def edit_automation(key: str, body: AutomationEdit):
    with db.conn:
        value = read('automation', key)
        if body.enabled and value['runs_started'] >= value['max_runs']:
            raise HTTPException(409, 'automation has exhausted its authorized run count')
        value.update(enabled=body.enabled, state='active' if body.enabled else 'disabled')
        save('automation', value)
    return value


@router.post('/worker/research-runs/{key}/claim', response_model=Run, dependencies=[Depends(auth.worker)])
async def claim_run(key: str, body: LeaseInput):
    with db.conn:
        value = read('run', key)
        job = db.one('SELECT * FROM jobs WHERE id = ?', body.job_id)
        if value['job_id'] != body.job_id or job is None or job['status'] != 'running':
            raise HTTPException(409, 'research run requires its own leased job')
        if value['status'] != 'queued':
            raise HTTPException(409, f'research run is {value["status"]}')
        now = db.now()
        value.update(status='running', started_at=db.ts(now), lease_token=str(uuid.uuid4()),
                     lease_until=db.ts(now + timedelta(seconds=LEASE_SECONDS)))
        save('run', value)
    return value


def owned_run(key, token):
    value = read('run', key)
    if value['status'] != 'running' or value['lease_token'] != token:
        raise HTTPException(409, f'run {key} is not owned/running: {value["status"]}')
    if db.parse(value['lease_until']) < db.now():
        raise HTTPException(409, f'run {key} lease expired')
    return value


@router.post('/worker/research-runs/{key}/heartbeat', response_model=Run, dependencies=[Depends(auth.worker)])
async def heartbeat_run(key: str, body: LeaseToken):
    with db.conn:
        value = owned_run(key, body.lease_token)
        value['lease_until'] = db.ts(db.now() + timedelta(seconds=LEASE_SECONDS))
        save('run', value)
    return value


@router.post('/worker/research-runs/{key}/checkpoint', response_model=Run, dependencies=[Depends(auth.worker)])
async def checkpoint_run(key: str, body: CheckpointInput):
    with db.conn:
        value = owned_run(key, body.lease_token)
        value.update(summary=body.summary, artifacts=[a.model_dump() for a in body.artifacts])
        save('run', value)
    return value


@router.post('/worker/research-runs/{key}/finish', response_model=Run, dependencies=[Depends(auth.worker)])
async def finish_run(key: str, body: FinishInput):
    with db.conn:
        value = read('run', key)
        if value['status'] in TERMINAL and value['lease_token'] == body.lease_token:
            return value  # lost HTTP response: completion has already committed atomically
        value = owned_run(key, body.lease_token)
        output = []
        seen = set()
        for candidate in body.ideas:
            existing = candidate.existing_id
            if existing is not None:
                if existing not in value['idea_revisions'] or existing in seen:
                    raise HTTPException(422, f'output idea {existing} was not selected or appears twice')
                seen.add(existing)
            revision = value['idea_revisions'][existing] if existing is not None else None
            idea = write_idea(candidate.content.model_dump(mode='json'), existing, revision)
            output.append(idea['id'])
        value.update(output_idea_ids=output, artifacts=[a.model_dump() for a in body.artifacts])
        for seed_id in value['seed_ids']:
            seed = read('seed', seed_id)
            seed['last_explored_at'] = db.ts(db.now())
            save('seed', seed)
        end(value, body.status, body.summary, body.error)
    return value


def scheduled_tick():
    """Called by the existing hub watchdog; finite authorization, no second scheduler."""
    sync_seeds()
    now = db.now()
    with db.conn:
        for run in records('run'):
            if run['status'] == 'queued':
                job = db.one('SELECT status, started_at FROM jobs WHERE id = ?', run['job_id'])
                if job['status'] == 'running' and db.parse(job['started_at']) + timedelta(seconds=LEASE_SECONDS) < now:
                    end(run, 'failed', '研究任务领用后执行器未启动。', 'research executor never claimed run')
            if run['status'] == 'running' and (db.parse(run['lease_until']) < now or
                    db.parse(run['started_at']) + timedelta(minutes=run['budget']['wall_minutes']) < now):
                end(run, 'failed', '研究执行器租约或授权时限已到期；结果未自动接受。', 'research lease or wall-time expired')
        present = [s['id'] for s in records('seed') if s['present']]
        for auto in records('automation'):
            if not auto['enabled']:
                continue
            if auto['runs_started'] >= auto['max_runs']:
                auto.update(enabled=False, state='exhausted')
                save('automation', auto)
                continue
            if any(r['automation_id'] == auto['id'] and r['status'] not in TERMINAL for r in records('run')):
                continue
            unseen = [key for key in present if key not in auto['last_seed_ids']]
            due = db.parse(auto['next_at']) <= now
            if not due or (auto['trigger'] == 'new_seed' and not unseen):
                continue
            request = dict(auto['run'], idempotency_key=f'{auto["id"]}:{auto["runs_started"]}')
            if auto['trigger'] == 'new_seed':
                request['seed_ids'] = list(dict.fromkeys(request['seed_ids'] + unseen))
            # Continue this automation's own outputs and ideas already associated with its selected seeds.
            # Do not mutate the original authorized spec: idempotency remains comparable.
            continuations = [key for prior in records('run') if prior['automation_id'] == auto['id']
                             and prior['status'] in ('completed', 'needs_input') for key in prior['output_idea_ids']]
            linked = [key for sid in request['seed_ids'] for key in read('seed', sid)['idea_ids']]
            additions = [key for key in continuations + linked if read('idea', key)['status'] != 'archived']
            request['idea_ids'] = list(dict.fromkeys(request['idea_ids'] + additions))
            enqueue(RunInput.model_validate(request), auto['id'])
            auto['runs_started'] += 1
            auto['next_at'] = db.ts(now + timedelta(minutes=auto['interval_minutes']))
            auto['last_seed_ids'] = present
            if auto['runs_started'] >= auto['max_runs']:
                auto.update(enabled=False, state='exhausted')
            save('automation', auto)


@router.get('/worker/research-result-schema', dependencies=[Depends(auth.worker)])
async def result_schema():
    from .idea_models import RunResult
    return RunResult.model_json_schema()
