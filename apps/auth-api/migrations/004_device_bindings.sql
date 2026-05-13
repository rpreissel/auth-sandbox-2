create table if not exists device_bindings (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  user_id text not null,
  keycloak_user_id text,
  keycloak_credential_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index device_bindings_device_active_unique
  on device_bindings (device_id)
  where active = true;

create index idx_device_bindings_user_id on device_bindings(user_id);

insert into device_bindings (device_id, user_id, keycloak_user_id, keycloak_credential_id)
  select id, user_id, keycloak_user_id, keycloak_credential_id
  from devices
  where user_id is not null;

alter table devices
  drop column if exists user_id,
  drop column if exists keycloak_user_id,
  drop column if exists keycloak_credential_id,
  drop column if exists enc_pub_key,
  drop constraint if exists devices_user_name_unique,
  drop constraint if exists devices_user_name_unique_bound;

alter table devices
  add constraint devices_device_name_unique unique (device_name);

drop index if exists devices_user_name_unique_bound;
drop index if exists idx_devices_user_id;