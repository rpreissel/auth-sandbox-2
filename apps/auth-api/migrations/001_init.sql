create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  public_key text not null,
  public_key_hash text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists account_user (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  handover_secret text unique,
  first_name text not null,
  last_name text not null,
  birth_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists device_bindings (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null unique references devices(id) on delete cascade,
  user_id text not null,
  keycloak_user_id text,
  keycloak_credential_id text,
  device_name text not null,
  created_at timestamptz not null default now(),
  constraint device_bindings_user_device_name_unique unique (user_id, device_name)
);

create table if not exists login_challenges (
  id uuid primary key default gen_random_uuid(),
  nonce text not null unique,
  user_id text not null,
  device_id uuid not null references devices(id) on delete cascade,
  public_key_hash text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

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
  final_artifact_kind text,
  final_artifact_code text,
  final_artifact_expires_at timestamptz,
  final_artifact_consumed_at timestamptz,
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

create table if not exists registration_person_codes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references account_user(id) on delete cascade,
  code text not null,
  expires_at timestamptz not null,
  use_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists registration_person_sms_numbers (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references account_user(id) on delete cascade,
  phone_number text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_account_user_user_id on account_user(user_id);
create index if not exists idx_login_challenges_nonce on login_challenges(nonce);
create index if not exists idx_assurance_flows_status on assurance_flows(status);
create index if not exists idx_assurance_flows_expires_at on assurance_flows(expires_at);
create index if not exists idx_assurance_flows_resolved_user_id on assurance_flows(resolved_user_id);
create index if not exists idx_assurance_flows_device_id on assurance_flows(device_id);
create unique index if not exists idx_assurance_flows_idempotency_key on assurance_flows(idempotency_key) where idempotency_key is not null;
create unique index if not exists idx_assurance_flows_final_artifact_code on assurance_flows(final_artifact_code) where final_artifact_code is not null;
create index if not exists idx_assurance_flow_events_flow_id on assurance_flow_events(flow_id);
create index if not exists idx_account_user_identity on account_user(user_id, first_name, last_name, birth_date);
create index if not exists idx_registration_person_codes_person_id on registration_person_codes(person_id, expires_at desc);
create index if not exists idx_device_bindings_user_id on device_bindings(user_id);
create index if not exists idx_device_bindings_device_id on device_bindings(device_id);
