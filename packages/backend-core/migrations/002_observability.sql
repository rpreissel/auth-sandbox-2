create schema if not exists observability;

create table if not exists observability.traces (
  trace_id uuid primary key,
  correlation_id text not null unique,
  trace_type text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  root_client text,
  root_entrypoint text,
  user_id text,
  device_id text,
  session_id text,
  title text not null,
  summary text
);

create table if not exists observability.spans (
  span_id uuid primary key,
  trace_id uuid not null references observability.traces(trace_id) on delete cascade,
  parent_span_id uuid references observability.spans(span_id) on delete cascade,
  kind text not null,
  actor_type text not null,
  actor_name text not null,
  target_name text,
  operation text not null,
  method text,
  url text,
  route text,
  status text not null default 'running',
  status_code integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  user_id text,
  device_id text,
  session_id text,
  challenge_id text,
  notes text
);

create table if not exists observability.artifacts (
  artifact_id uuid primary key,
  span_id uuid not null references observability.spans(span_id) on delete cascade,
  artifact_type text not null,
  name text not null,
  content_type text,
  encoding text,
  direction text,
  raw_value text not null,
  derived_value jsonb,
  explanation text,
  created_at timestamptz not null default now()
);

create table if not exists observability.field_explanations (
  explanation_id uuid primary key,
  artifact_id uuid not null references observability.artifacts(artifact_id) on delete cascade,
  field_path text not null,
  label text not null,
  raw_value text,
  normalized_value text,
  explanation text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_observability_traces_started_at on observability.traces(started_at desc);
create index if not exists idx_observability_traces_user_id on observability.traces(user_id);
create index if not exists idx_observability_traces_device_id on observability.traces(device_id);
create index if not exists idx_observability_spans_trace_id on observability.spans(trace_id);
create index if not exists idx_observability_spans_parent_span_id on observability.spans(parent_span_id);
create index if not exists idx_observability_artifacts_span_id on observability.artifacts(span_id);
create index if not exists idx_observability_field_explanations_artifact_id on observability.field_explanations(artifact_id);
