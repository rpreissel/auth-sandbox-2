alter table device_bindings
  add column if not exists device_name text not null;

update device_bindings db
set device_name = d.device_name
from devices d
where d.id = db.device_id;

alter table device_bindings
  add constraint device_bindings_user_device_name_unique unique (user_id, device_name);

alter table devices
  drop column if exists device_name;

drop index if exists devices_device_name_unique;

create index if not exists idx_device_bindings_device_id on device_bindings(device_id);

alter table device_bindings
  drop column if exists active;

drop index if exists device_bindings_device_active_unique;