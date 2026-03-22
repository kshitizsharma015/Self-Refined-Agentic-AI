-- Run this in Supabase SQL editor
create table if not exists public.agent_memory_episodes (
  id text primary key,
  goal text not null,
  stats jsonb not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_memory_episodes_created_at
  on public.agent_memory_episodes (created_at desc);

-- For demo projects, service role bypasses RLS.
-- Enable RLS + policies later when moving to production.
