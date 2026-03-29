-- Pairs manifest + ingest index for af3-matrix (server uses service role; no anon policies needed).

create table if not exists public.af3_session_manifests (
  session_id text primary key,
  manifest jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.af3_ingests (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  ingest_id text not null,
  parsed_pathname text not null,
  extracted_prefix text not null,
  created_at timestamptz not null default now(),
  unique (session_id, ingest_id)
);

create index if not exists af3_ingests_session_created_idx
  on public.af3_ingests (session_id, created_at desc);

alter table public.af3_session_manifests enable row level security;
alter table public.af3_ingests enable row level security;

-- No policies: only the Supabase service role (used by API routes) bypasses RLS.
