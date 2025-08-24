create table if not exists tenants(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists api_keys(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  hash text not null,
  role text check (role in ('admin','dev','analyst')),
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists agents(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  name text,
  version int default 1,
  config jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists calls(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  direction text,
  from_num text,
  to_num text,
  started_at timestamptz,
  ended_at timestamptz,
  status text,
  duration_sec int,
  cost_inr numeric(12,2) default 0
);

create table if not exists events(
  id bigserial primary key,
  call_id uuid references calls(id) on delete cascade,
  ts timestamptz default now(),
  kind text,
  payload jsonb
);

create table if not exists call_costs(
  id bigserial primary key,
  call_id uuid references calls(id) on delete cascade,
  type text check (type in ('transport','stt','tts','llm','platform','other')) not null,
  provider text,
  minutes numeric(10,2),
  units numeric(12,2),
  cost_inr numeric(12,2) not null default 0,
  created_at timestamptz default now()
);

create materialized view if not exists call_stats as
select tenant_id, date_trunc('day', started_at) d, count(*) n_calls,
       sum(duration_sec) dur, avg(duration_sec) avg_dur, sum(cost_inr) cost_inr
from calls group by 1,2;

