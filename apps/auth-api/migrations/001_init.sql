create table if not exists registration_codes (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  display_name text,
  code text not null unique,
  expires_at timestamptz not null,
  use_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  device_name text not null,
  public_key text not null,
  public_key_hash text not null unique,
  enc_pub_key text not null,
  keycloak_user_id text not null,
  keycloak_credential_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint devices_user_name_unique unique (user_id, device_name)
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

create index if not exists idx_registration_codes_user_id on registration_codes(user_id);
create index if not exists idx_devices_user_id on devices(user_id);
create index if not exists idx_login_challenges_nonce on login_challenges(nonce);
