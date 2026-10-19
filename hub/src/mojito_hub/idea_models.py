"""Idea Lab contracts: required fields and explicit permissions, no inferred budgets."""
from typing import Literal
from pydantic import AwareDatetime, Field, model_validator
from .models import Body

class SeedSnapshot(Body):
    kind: Literal['idea', 'paper', 'author', 'blog']
    text: str
    source: str
    area: str | None
    note: str | None
    at: str

class Seed(Body):
    id: str
    kind: str
    text: str
    source: str
    at: str
    snapshot: SeedSnapshot
    reason: str
    idea_ids: list[str]
    present: bool
    last_explored_at: str | None

class SeedEdit(Body):
    reason: str

class Evidence(Body):
    id: str
    claim: str
    source: str
    kind: Literal['observation', 'literature', 'experiment', 'review']
    at: AwareDatetime

class JudgmentChange(Body):
    at: AwareDatetime
    before: str
    after: str
    reason: str

class Artifact(Body):
    kind: Literal['source', 'experiment', 'paper', 'review', 'notion']
    title: str
    url: str

class IdeaInput(Body):
    title: str = Field(min_length=1, max_length=200)
    question: str = Field(min_length=1)
    importance: str
    status: Literal['developing', 'ready', 'experimenting', 'supported', 'contradicted', 'archived']
    seed_ids: list[str]
    hypotheses: list[str]
    evidence: list[Evidence]
    changes: list[JudgmentChange]
    next_step: str
    artifacts: list[Artifact]
    notion_url: str | None
    notion_sync: Literal['pending', 'synced']

    @model_validator(mode='after')
    def notion_link(self):
        if self.notion_sync == 'synced' and (self.notion_url is None or not self.notion_url.startswith('https://')):
            raise ValueError('synced requires a verified Notion HTTPS URL')
        return self

class IdeaEdit(IdeaInput):
    revision: int = Field(ge=1)

class Idea(IdeaEdit):
    id: str
    created_at: str
    updated_at: str

class IdeaSyncInput(Body):
    operation_id: str = Field(min_length=1, max_length=200, pattern=r'^[A-Za-z0-9._:-]+$')
    existing_id: str | None = Field(min_length=1)
    revision: int | None = Field(ge=1)
    content: IdeaInput

    @model_validator(mode='after')
    def operation(self):
        if (self.existing_id is None) != (self.revision is None):
            raise ValueError('existing_id and revision must both be null for creation or both present for update')
        evidence_ids = [evidence.id for evidence in self.content.evidence]
        if len(evidence_ids) != len(set(evidence_ids)):
            raise ValueError(f'evidence ids must be unique: {evidence_ids}')
        return self

class IdeaSyncReceipt(Body):
    operation_id: str
    idea: Idea

class Budget(Body):
    wall_minutes: int = Field(ge=1, le=120)
    max_turns: int = Field(ge=1, le=100)
    allow_cpu: bool
    allow_write: bool

    @model_validator(mode='after')
    def cpu_artifacts(self):
        if self.allow_cpu and not self.allow_write:
            raise ValueError('CPU execution requires permission to write reproducible artifacts')
        return self

class RunSpec(Body):
    title: str = Field(min_length=1, max_length=200)
    goal: str = Field(min_length=1)
    direction: str = Field(min_length=1)
    mode: Literal['explore', 'develop', 'experiment', 'write', 'review', 'cycle']
    seed_ids: list[str]
    idea_ids: list[str]
    budget: Budget
    experiment_policy: str

class RunInput(RunSpec):
    idempotency_key: str = Field(min_length=8, max_length=200)

RunStatus = Literal['queued', 'running', 'completed', 'needs_input', 'failed', 'cancelled']

class Run(RunInput):
    id: str
    job_id: str
    status: RunStatus
    created_at: str
    started_at: str | None
    finished_at: str | None
    error: str | None
    summary: str
    idea_revisions: dict[str, int]
    output_idea_ids: list[str]
    artifacts: list[Artifact]
    lease_token: str | None
    lease_until: str | None
    automation_id: str | None

class AutomationInput(Body):
    idempotency_key: str = Field(min_length=8, max_length=200)
    title: str = Field(min_length=1)
    enabled: bool
    trigger: Literal['interval', 'new_seed']
    interval_minutes: int = Field(ge=5, le=43200)
    max_runs: int = Field(ge=1, le=100)
    run: RunSpec

class Automation(AutomationInput):
    id: str
    runs_started: int
    next_at: str
    last_seed_ids: list[str]
    state: Literal['active', 'disabled', 'exhausted']

class AutomationEdit(Body):
    enabled: bool

class Lab(Body):
    seeds: list[Seed]
    ideas: list[Idea]
    runs: list[Run]
    automations: list[Automation]

class LeaseInput(Body):
    job_id: str

class LeaseToken(Body):
    lease_token: str

class CheckpointInput(LeaseToken):
    summary: str
    artifacts: list[Artifact]

class GeneratedIdea(Body):
    existing_id: str | None
    content: IdeaInput

class RunResult(Body):
    status: Literal['completed', 'needs_input', 'failed']
    summary: str
    error: str | None
    ideas: list[GeneratedIdea]
    artifacts: list[Artifact]

class FinishInput(RunResult):
    lease_token: str
