drop index if exists idx_tanmock_entries_user_tan_unique;
drop index if exists idx_tanmock_entries_user_id;

create unique index if not exists idx_tanmock_entries_source_user_tan_unique
  on tanmock_entries(source_user_id, tan);

alter table tanmock_entries drop column if exists user_id;
