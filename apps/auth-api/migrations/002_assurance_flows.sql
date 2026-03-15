create table if not exists assurance_flows (
  id text primary key,
  purpose text not null,
  status text not null,
  current_method text,
  requested_acr text,
  target_assurance text,
  device_id uuid references devices(id) on delete set null,
  user_hint text,
  prospective_user_id text,
  resolved_user_id text,
  challenge_binding_json jsonb not null default '{}'::jsonb,
  context_json jsonb not null default '{}'::jsonb,
  method_state_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  idempotency_key text,
  finalize_lock_version integer not null default 0,
  finalize_locked_at timestamptz,
  expires_at timestamptz not null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assurance_flows_purpose_check check (purpose in ('registration', 'account_upgrade', 'step_up')),
  constraint assurance_flows_status_check check (status in ('started', 'method_in_progress', 'method_verified', 'finalizable', 'finalized', 'failed', 'expired'))
);

create table if not exists assurance_flow_events (
  id uuid primary key default gen_random_uuid(),
  flow_id text not null references assurance_flows(id) on delete cascade,
  event_type text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_assurance_flows_status on assurance_flows(status);
create index if not exists idx_assurance_flows_expires_at on assurance_flows(expires_at);
create index if not exists idx_assurance_flows_resolved_user_id on assurance_flows(resolved_user_id);
create index if not exists idx_assurance_flows_device_id on assurance_flows(device_id);
create unique index if not exists idx_assurance_flows_idempotency_key on assurance_flows(idempotency_key) where idempotency_key is not null;
create index if not exists idx_assurance_flow_events_flow_id on assurance_flow_events(flow_id);
