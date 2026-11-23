-- Rotinas — tarefas semanais que viram card no board
-- Uma rotina é um "molde" com dias da semana. No dia marcado, o app (cliente)
-- cria um card na área da rotina com prazo = aquele dia. Idempotente.
--
-- Decisões:
--  • Sem coluna de destino: o card vai para a 1ª coluna da área no momento da
--    geração (colunas podem ser apagadas; guardar o id quebraria a rotina).
--  • last_generated_date evita card duplicado: o cliente "reserva" a data com
--    um UPDATE condicional e só cria o card se a reserva voltou uma linha.
--    Duas abas/dispositivos abertos ao mesmo tempo não duplicam.
--  • weekdays: 0 = domingo … 6 = sábado (igual ao habit tracker).

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  title text not null,
  prio text not null default 'Média',
  weekdays smallint[] not null,
  active boolean not null default true,
  last_generated_date date,
  created_at timestamptz not null default now()
);

comment on table public.routines is 'Rotinas semanais: geram um card no board nos dias marcados.';

create index if not exists routines_user_id_idx on public.routines (user_id);

alter table public.routines enable row level security;

drop policy if exists routines_select_own on public.routines;
create policy routines_select_own on public.routines
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists routines_insert_own on public.routines;
create policy routines_insert_own on public.routines
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists routines_update_own on public.routines;
create policy routines_update_own on public.routines
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists routines_delete_own on public.routines;
create policy routines_delete_own on public.routines
  for delete to authenticated using (auth.uid() = user_id);
