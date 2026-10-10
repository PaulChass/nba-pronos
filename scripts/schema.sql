-- Pronos NBA — database schema (Postgres / Neon). Idempotent: safe to re-run.

create table if not exists users (
  id               serial primary key,
  pseudo           text not null,
  -- Normalized pseudo (trimmed, lower-cased, NFKC) used for uniqueness and login.
  pseudo_key       text not null unique,
  pin_hash         text not null,
  failed_attempts  int not null default 0,
  locked_until     timestamptz,
  -- Bumped on PIN reset: invalidates every existing session cookie.
  session_version  int not null default 1,
  created_at       timestamptz not null default now()
);

create table if not exists predictions (
  user_id         int primary key references users(id) on delete cascade,
  grid            jsonb not null,
  answers         jsonb not null default '{}'::jsonb,
  hot_takes       jsonb not null default '{"teams":[],"questions":[]}'::jsonb,
  -- Server-computed: the grid satisfies every blocking rule (30 teams, 1230 wins, order).
  grid_valid      boolean not null default false,
  first_saved_at  timestamptz not null default now(),
  last_saved_at   timestamptz not null default now()
);

-- Admin overrides of question results (auto results come from ESPN at request time).
-- answer: {"status":"final","winners":["123"]} or {"status":"void"}.
create table if not exists results (
  question_id  text primary key,
  answer       jsonb not null,
  updated_at   timestamptz not null default now()
);

-- Small key/value store: last good ESPN standings, futures odds snapshot (frozen at lock), etc.
create table if not exists kv (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
