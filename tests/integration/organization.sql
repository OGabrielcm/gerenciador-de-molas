\set ON_ERROR_STOP on
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.tracks(id,user_id,name,bg,border,fg,dark_bg,dark_fg,"order") values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111','A','#fff','#000','#000','#000','#fff',0),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','11111111-1111-4111-8111-111111111111','B','#fff','#000','#000','#000','#fff',1),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','11111111-1111-4111-8111-111111111111','Hidden','#fff','#000','#000','#000','#fff',2),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','22222222-2222-4222-8222-222222222222','Other','#fff','#000','#000','#000','#fff',0);
insert into public.tasks(id,user_id,col,track,title,updated_at,done_at) values
 ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','11111111-1111-4111-8111-111111111111','done','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Done',now(),now()),
 ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2','11111111-1111-4111-8111-111111111111','todo','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Active',now(),null),
 ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3','22222222-2222-4222-8222-222222222222','done','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Other user',now(),now()),
 ('cccccccc-cccc-4ccc-8ccc-ccccccccccc4','11111111-1111-4111-8111-111111111111','done','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Other area',now(),now());
insert into public.comments(task_id,user_id,text) values ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','11111111-1111-4111-8111-111111111111','Keep this comment');
create table public.test_retained_attachment(task_id uuid references public.tasks(id),payload text);
insert into public.test_retained_attachment values ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','fake-file-content');
grant select,insert,update,delete on all tables in schema public to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$
declare ids text[]; rejected boolean:=false; previous_time timestamptz; previous_done timestamptz; n integer;
begin
 select array_agg(id::text order by "order",id::text) into ids from public.tracks;
 if cardinality(ids)<>3 then raise exception 'RLS leaked another user'; end if;
 perform public.reorder_areas(array[ids[3],ids[1],ids[2]],ids);
 select count(*) into n from public.tracks where id::text=ids[3] and "order"=0;
 if n<>1 then raise exception 'Reorder did not persist'; end if;
 begin perform public.reorder_areas(ids,ids); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Stale reorder accepted'; end if;
 rejected:=false;
 select array_agg(id::text order by "order",id::text) into ids from public.tracks;
 begin perform public.reorder_areas(array[ids[1],ids[2],'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'],ids); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Foreign area accepted'; end if;
 select updated_at,done_at into previous_time,previous_done from public.tasks where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
 perform public.archive_done_area('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['cccccccc-cccc-4ccc-8ccc-ccccccccccc1']);
 if not exists(select 1 from public.tasks where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1' and manual_archived_at is not null and updated_at=previous_time and done_at=previous_done and col='done') then raise exception 'Archive changed completion or failed'; end if;
 if exists(select 1 from public.tasks where id<>'cccccccc-cccc-4ccc-8ccc-ccccccccccc1' and manual_archived_at is not null) then raise exception 'Archive affected other cards'; end if;
 if (select count(*) from public.comments)<>1 or (select count(*) from public.test_retained_attachment)<>1 then raise exception 'Lost related content'; end if;
 rejected:=false;
 begin perform public.restore_archived_tasks(array['cccccccc-cccc-4ccc-8ccc-ccccccccccc1','cccccccc-cccc-4ccc-8ccc-ccccccccccc3']); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Foreign restore accepted'; end if;
 if not exists(select 1 from public.tasks where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1' and manual_archived_at is not null) then raise exception 'Partial restore committed'; end if;
 perform public.restore_archived_tasks(array['cccccccc-cccc-4ccc-8ccc-ccccccccccc1']);
 if not exists(select 1 from public.tasks where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1' and manual_archived_at is null and archive_snoozed_until>now()+interval '6 days' and done_at=previous_done and updated_at=previous_time) then raise exception 'Restore failed or changed timestamps'; end if;
 update public.tasks set title='Edited later',updated_at=now() where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
 if (select done_at from public.tasks where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1') is distinct from previous_done then raise exception 'Edit changed completion'; end if;
 update public.tasks set col='todo' where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
 if exists(select 1 from public.tasks where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1' and (done_at is not null or archive_snoozed_until is not null)) then raise exception 'Transition failed to clear archive fields'; end if;
end $$;
reset role;
-- Independently read the other user's rows after all actions.
do $$ begin
 if not exists(select 1 from public.tracks where user_id='22222222-2222-4222-8222-222222222222' and "order"=0) then raise exception 'Other user order changed'; end if;
 if not exists(select 1 from public.tasks where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc3' and manual_archived_at is null) then raise exception 'Other user archive changed'; end if;
end $$;
select 'PostgreSQL transaction, RLS, timestamps and retention checks passed' as result;
