#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set db_name="$POSTGRES_DB" \
  --set auth_user="${AUTH_API_DB_USER:-auth_sandbox}" \
  --set auth_password="${AUTH_API_DB_PASSWORD:-auth_sandbox}" \
  --set auth_schema="${AUTH_API_DB_SCHEMA:-auth_api}" \
  --set keycloak_user="${KEYCLOAK_DB_USER:-keycloak}" \
  --set keycloak_password="${KEYCLOAK_DB_PASSWORD:-keycloak}" \
  --set keycloak_schema="${KEYCLOAK_DB_SCHEMA:-keycloak}" <<'SQL'
create extension if not exists pgcrypto;

select format('create role %I login password %L', :'auth_user', :'auth_password')
where not exists (select 1 from pg_roles where rolname = :'auth_user')
\gexec

select format('alter role %I login password %L', :'auth_user', :'auth_password')
\gexec

select format('create role %I login password %L', :'keycloak_user', :'keycloak_password')
where not exists (select 1 from pg_roles where rolname = :'keycloak_user')
\gexec

select format('alter role %I login password %L', :'keycloak_user', :'keycloak_password')
\gexec

select format('grant connect on database %I to %I', :'db_name', :'auth_user')
\gexec

select format('grant connect on database %I to %I', :'db_name', :'keycloak_user')
\gexec

select format('revoke all on database %I from public', :'db_name')
\gexec

select format('grant connect, temporary on database %I to %I', :'db_name', :'auth_user')
\gexec

select format('grant connect, temporary on database %I to %I', :'db_name', :'keycloak_user')
\gexec

select format('create schema if not exists %I authorization %I', :'auth_schema', :'auth_user')
\gexec

select format('create schema if not exists %I authorization %I', :'keycloak_schema', :'keycloak_user')
\gexec

select format('alter schema %I owner to %I', :'auth_schema', :'auth_user')
\gexec

select format('alter schema %I owner to %I', :'keycloak_schema', :'keycloak_user')
\gexec

select format('grant usage, create on schema %I to %I', :'auth_schema', :'auth_user')
\gexec

select format('grant usage, create on schema %I to %I', :'keycloak_schema', :'keycloak_user')
\gexec

select 'revoke create on schema public from public'
\gexec

select format('grant usage on schema public to %I', :'auth_user')
\gexec

select format('grant usage on schema public to %I', :'keycloak_user')
\gexec

select format('revoke all on schema %I from public', :'auth_schema')
\gexec

select format('revoke all on schema %I from public', :'keycloak_schema')
\gexec

select format('revoke all on all tables in schema %I from public', :'auth_schema')
\gexec

select format('revoke all on all sequences in schema %I from public', :'auth_schema')
\gexec

select format('revoke all on all tables in schema %I from public', :'keycloak_schema')
\gexec

select format('revoke all on all sequences in schema %I from public', :'keycloak_schema')
\gexec

select format('alter role %I in database %I set search_path to %I, public', :'auth_user', :'db_name', :'auth_schema')
\gexec

select format('alter role %I in database %I set search_path to %I, public', :'keycloak_user', :'db_name', :'keycloak_schema')
\gexec
SQL
