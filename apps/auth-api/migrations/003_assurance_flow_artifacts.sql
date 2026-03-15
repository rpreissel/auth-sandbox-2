alter table assurance_flows
  add column if not exists final_artifact_kind text,
  add column if not exists final_artifact_code text,
  add column if not exists final_artifact_expires_at timestamptz,
  add column if not exists final_artifact_consumed_at timestamptz;

create unique index if not exists idx_assurance_flows_final_artifact_code
  on assurance_flows(final_artifact_code)
  where final_artifact_code is not null;
