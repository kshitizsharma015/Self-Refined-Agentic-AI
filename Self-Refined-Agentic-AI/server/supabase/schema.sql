-- Run this in Supabase SQL editor
create extension if not exists vector;

create table if not exists public.agent_memory_episodes (
  id text primary key,
  goal text not null,
  stats jsonb not null,
  snapshot jsonb not null,
  embedding vector(64),
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_memory_episodes_created_at
  on public.agent_memory_episodes (created_at desc);

create index if not exists idx_agent_memory_episodes_embedding
  on public.agent_memory_episodes using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

create or replace function public.match_agent_memory_episodes(
  query_embedding vector(64),
  match_count int default 5
)
returns table (
  id text,
  goal text,
  stats jsonb,
  snapshot jsonb,
  created_at timestamptz,
  similarity float
)
language sql
stable
as $$
  select
    e.id,
    e.goal,
    e.stats,
    e.snapshot,
    e.created_at,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.agent_memory_episodes e
  where e.embedding is not null
  order by e.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

-- For demo projects, service role bypasses RLS.
-- Enable RLS + policies later when moving to production.
