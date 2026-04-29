alter table tanmock_entries drop constraint if exists tanmock_entries_tan_key;

create unique index if not exists idx_tanmock_entries_user_tan_unique
  on tanmock_entries(user_id, tan);
