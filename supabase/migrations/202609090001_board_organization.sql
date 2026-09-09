-- Board organization. Apply to a test environment first; no production rollout implied.
begin;
alter table public.tasks add column if not exists done_at timestamptz;
alter table public.tasks add column if not exists manual_archived_at timestamptz;
alter table public.tasks add column if not exists archive_snoozed_until timestamptz;
-- Legacy completion time is an approximation: preserve the original archive clock.
update public.tasks set done_at = updated_at where col = 'done' and done_at is null;

create or replace function public.track_done_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    if new.col = 'done' then new.done_at := coalesce(new.done_at, now()); end if;
  elsif new.col is distinct from old.col then
    new.manual_archived_at := null;
    new.archive_snoozed_until := null;
    new.done_at := case when new.col = 'done' then now() else null end;
  end if;
  return new;
end $$;
drop trigger if exists track_done_transition on public.tasks;
create trigger track_done_transition before insert or update of col on public.tasks
for each row execute function public.track_done_transition();

create or replace function public.reorder_areas(ordered_ids text[], expected_ids text[])
returns setof public.tracks language plpgsql security invoker set search_path = '' as $$
declare current_ids text[];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 921));
  perform 1 from public.tracks where user_id = auth.uid() order by id for update;
  select coalesce(array_agg(id::text order by "order", id::text), '{}'::text[]) into current_ids
    from public.tracks where user_id = auth.uid();
  if current_ids is distinct from expected_ids then raise exception 'Area order changed; reload before reordering'; end if;
  if ordered_ids is null or cardinality(ordered_ids) <> cardinality(current_ids)
     or (select count(distinct x) from unnest(ordered_ids) x) <> cardinality(current_ids)
     or not (ordered_ids @> current_ids and current_ids @> ordered_ids)
  then raise exception 'Invalid area list'; end if;
  update public.tracks t set "order" = (u.position - 1)::integer
    from unnest(ordered_ids) with ordinality u(id, position)
    where t.id::text = u.id and t.user_id = auth.uid();
  return query select * from public.tracks where user_id = auth.uid() order by "order", id::text;
end $$;

create or replace function public.archive_done_area(area_id text, expected_ids text[])
returns setof public.tasks language plpgsql security invoker set search_path = '' as $$
declare eligible text[];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 922));
  perform 1 from public.tasks where user_id = auth.uid() and track::text = area_id order by id for update;
  select coalesce(array_agg(id::text order by id::text), '{}'::text[]) into eligible
  from public.tasks where user_id = auth.uid() and track::text = area_id and col = 'done'
    and manual_archived_at is null
    and (archive_snoozed_until > now() or coalesce(done_at, updated_at) >= now() - interval '7 days');
  if expected_ids is null or cardinality(expected_ids) = 0
    or cardinality(expected_ids) <> cardinality(eligible)
    or (select count(distinct x) from unnest(expected_ids) x) <> cardinality(eligible)
    or not (expected_ids @> eligible and eligible @> expected_ids)
  then raise exception 'Completed tasks changed; reload before archiving'; end if;
  return query update public.tasks set manual_archived_at = now(), archive_snoozed_until = null
    where user_id = auth.uid() and id::text = any(eligible) returning *;
end $$;

create or replace function public.restore_archived_tasks(task_ids text[])
returns setof public.tasks language plpgsql security invoker set search_path = '' as $$
declare eligible text[];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 922));
  perform 1 from public.tasks where user_id = auth.uid() and id::text = any(task_ids) order by id for update;
  select coalesce(array_agg(id::text), '{}'::text[]) into eligible from public.tasks
    where user_id = auth.uid() and id::text = any(task_ids) and col = 'done';
  if task_ids is null or cardinality(task_ids) = 0
    or cardinality(task_ids) <> cardinality(eligible)
    or (select count(distinct x) from unnest(task_ids) x) <> cardinality(eligible)
  then raise exception 'Invalid completed task selection'; end if;
  return query update public.tasks set manual_archived_at = null, archive_snoozed_until = now() + interval '7 days'
    where user_id = auth.uid() and id::text = any(eligible) returning *;
end $$;

revoke all on function public.reorder_areas(text[], text[]) from public, anon;
revoke all on function public.archive_done_area(text, text[]) from public, anon;
revoke all on function public.restore_archived_tasks(text[]) from public, anon;
grant execute on function public.reorder_areas(text[], text[]) to authenticated;
grant execute on function public.archive_done_area(text, text[]) to authenticated;
grant execute on function public.restore_archived_tasks(text[]) to authenticated;
commit;
