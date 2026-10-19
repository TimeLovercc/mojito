import type { InboxKind } from './types'

export type LabSeed = {
  id: string; kind: InboxKind; text: string; source: string; at: string
  snapshot: { kind: InboxKind; text: string; source: string; at: string; area: string | null; note: string | null }
  reason: string; idea_ids: string[]; present: boolean; last_explored_at: string | null
}
export type LabArtifact = { kind: 'source' | 'experiment' | 'paper' | 'review' | 'notion'; title: string; url: string }
export type LabIdea = {
  id: string; revision: number; title: string; question: string; importance: string
  status: 'developing' | 'ready' | 'experimenting' | 'supported' | 'contradicted' | 'archived'
  seed_ids: string[]; hypotheses: string[]
  evidence: { id: string; claim: string; source: string; kind: 'observation' | 'literature' | 'experiment' | 'review'; at: string }[]
  changes: { at: string; before: string; after: string; reason: string }[]
  next_step: string; artifacts: LabArtifact[]; notion_url: string | null; notion_sync: 'pending' | 'synced'
  created_at: string; updated_at: string
}
export type LabMode = 'explore' | 'develop' | 'experiment' | 'write' | 'review' | 'cycle'
export type LabRunSpec = {
  title: string; goal: string; direction: string; mode: LabMode; seed_ids: string[]; idea_ids: string[]
  budget: { wall_minutes: number; max_turns: number; allow_cpu: boolean; allow_write: boolean }
  experiment_policy: string
}
export type LabRun = LabRunSpec & {
  id: string; idempotency_key: string; job_id: string
  status: 'queued' | 'running' | 'completed' | 'needs_input' | 'failed' | 'cancelled'
  created_at: string; started_at: string | null; finished_at: string | null; error: string | null; summary: string
  idea_revisions: Record<string, number>; output_idea_ids: string[]; artifacts: LabArtifact[]
  lease_token: string | null; lease_until: string | null; automation_id: string | null
}
export type LabAutomation = {
  id: string; idempotency_key: string; title: string; enabled: boolean; trigger: 'interval' | 'new_seed'
  interval_minutes: number; max_runs: number; run: LabRunSpec; runs_started: number; next_at: string
  last_seed_ids: string[]; state: 'active' | 'disabled' | 'exhausted'
}
export type IdeaLabData = { seeds: LabSeed[]; ideas: LabIdea[]; runs: LabRun[]; automations: LabAutomation[] }
