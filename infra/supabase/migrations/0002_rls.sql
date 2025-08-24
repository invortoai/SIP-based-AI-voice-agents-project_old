-- Enable RLS
alter table tenants enable row level security;
alter table agents enable row level security;
alter table calls enable row level security;
alter table events enable row level security;
alter table call_costs enable row level security;

-- Basic RLS policies (placeholder: tenant_id = current_setting('app.tenant_id'))
create policy tenant_isolation_agents on agents
  for all using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

create policy tenant_isolation_calls on calls
  for all using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

create policy tenant_isolation_events on events
  for all using (
    exists (select 1 from calls c where c.id = events.call_id and c.tenant_id::text = current_setting('app.tenant_id', true))
  );

create policy tenant_isolation_costs on call_costs
  for all using (
    exists (select 1 from calls c where c.id = call_costs.call_id and c.tenant_id::text = current_setting('app.tenant_id', true))
  );

