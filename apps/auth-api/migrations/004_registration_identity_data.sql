create table if not exists registration_people (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  first_name text not null,
  last_name text not null,
  birth_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists registration_person_codes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references registration_people(id) on delete cascade,
  code text not null unique,
  expires_at timestamptz not null,
  use_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists registration_person_sms_numbers (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references registration_people(id) on delete cascade,
  phone_number text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_registration_people_identity
  on registration_people(user_id, first_name, last_name, birth_date);

create index if not exists idx_registration_person_codes_person_id
  on registration_person_codes(person_id, expires_at desc);
