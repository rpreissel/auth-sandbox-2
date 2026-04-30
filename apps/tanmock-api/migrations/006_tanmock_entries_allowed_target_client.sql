alter table tanmock_entries add column if not exists allowed_target_client_id text;

update tanmock_entries
set allowed_target_client_id = 'webmock-web'
where allowed_target_client_id is null;

alter table tanmock_entries alter column allowed_target_client_id set not null;
