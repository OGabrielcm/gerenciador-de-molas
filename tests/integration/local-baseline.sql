-- TEST ONLY: reconstructed minimal legacy baseline from README + shipped migrations.
-- For a disposable local Supabase project; never a production initialization script.
create table public.trilhas (id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),name text not null,bg text not null,fg text not null,created_at timestamptz not null default now());
create table public.tasks (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 col text not null,track text not null,type text default 'Task',parent_id uuid,
 title text not null,"desc" text,prio text default 'Média',date text,starred boolean default false,
 tags text[] default '{}',"order" float8 default 0,checklist jsonb default '[]',blocked_by text[] default '{}',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.user_profile(user_id uuid primary key references auth.users(id),onboarding_completed boolean default true,theme text default 'dark',created_at timestamptz default now(),updated_at timestamptz default now());
alter table public.tasks enable row level security;
alter table public.trilhas enable row level security;
alter table public.user_profile enable row level security;
create policy tasks_own on public.tasks for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy trilhas_own on public.trilhas for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy profiles_own on public.user_profile for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
