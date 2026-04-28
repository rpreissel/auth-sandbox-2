create table if not exists tanmock_entries (
  id uuid primary key default gen_random_uuid(),
  tan text not null unique,
  user_id text not null,
  source_user_id text not null,
  active boolean not null default true,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists tanmock_authorization_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  client_id text not null,
  redirect_uri text not null,
  scope text not null,
  state text,
  nonce text,
  code_challenge text,
  code_challenge_method text,
  broker_username text not null,
  source_user_id text not null,
  claims_json jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists tanmock_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  refresh_token text not null unique,
  broker_username text not null,
  source_user_id text not null,
  claims_json jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_tanmock_entries_user_id on tanmock_entries(user_id);
create index if not exists idx_tanmock_entries_source_user_id on tanmock_entries(source_user_id);
create index if not exists idx_tanmock_authorization_codes_expires_at on tanmock_authorization_codes(expires_at);
create index if not exists idx_tanmock_refresh_tokens_expires_at on tanmock_refresh_tokens(expires_at);
