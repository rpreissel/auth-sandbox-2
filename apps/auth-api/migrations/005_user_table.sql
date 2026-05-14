alter table registration_people rename to user;

alter table user
  add column if not exists handover_secret text unique;

create index if not exists idx_user_user_id on user(user_id);
drop index if exists idx_registration_people_identity;
create index if not exists idx_user_identity on user(user_id, first_name, last_name, birth_date);

alter table registration_person_codes
  drop constraint if exists registration_person_codes_person_id_fkey,
  add constraint registration_person_codes_person_id_fkey
    foreign key (person_id) references user(id) on delete cascade;

alter table registration_person_sms_numbers
  drop constraint if exists registration_person_sms_numbers_person_id_fkey,
  add constraint registration_person_sms_numbers_person_id_fkey
    foreign key (person_id) references user(id) on delete cascade;

drop index if exists idx_registration_person_codes_person_id;
create index if not exists idx_person_codes_person_id on registration_person_codes(person_id, expires_at desc);