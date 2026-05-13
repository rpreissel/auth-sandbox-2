alter table devices
  alter column user_id drop not null,
  alter column keycloak_user_id drop not null;

drop index if exists devices_user_name_idx;

create unique index devices_user_name_unique_bound
  on devices (user_id, device_name)
  where user_id is not null;

comment on constraint devices_user_name_unique on devices
  is 'Superseded by devices_user_name_unique_bound for NULL-safe uniqueness';