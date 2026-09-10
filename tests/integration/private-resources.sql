grant all on all tables in schema public,storage to authenticated;
grant select on all tables in schema storage to anon;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into tasks(id,user_id,col,track,title) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','todo','test','QA fake task');
insert into attachments(task_id,user_id,path,name) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001/fake.pdf','fake.pdf');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 if (select count(*) from attachments) <> 0 then raise exception 'foreign attachment leak'; end if;
 begin
  insert into comments(task_id,user_id,text) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','denied');
  raise exception 'foreign parent insert allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into activities(task_id,user_id,type,message) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','created','denied');
  raise exception 'foreign activity allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into time_logs(task_id,user_id,minutes) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',5);
  raise exception 'foreign time log allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into storage.objects(bucket_id,name,owner_id) values ('attachments','10000000-0000-0000-0000-000000000001/denied.pdf','00000000-0000-0000-0000-000000000002');
  raise exception 'foreign storage insert allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ begin
 if (select count(*) from attachments) <> 1 then raise exception 'owner lost attachment'; end if;
end $$;
insert into comments(task_id,user_id,text) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner allowed');
insert into storage.objects(bucket_id,name,owner_id) values ('attachments','10000000-0000-0000-0000-000000000001/allowed.pdf','00000000-0000-0000-0000-000000000001');
reset role;set role anon;
do $$ begin
 if exists(select 1 from storage.objects where bucket_id='attachments') then raise exception 'anonymous objects leaked';end if;
end $$;
reset role;
do $$ begin
 if (select public from storage.buckets where id='attachments') then raise exception 'public bucket';end if;
end $$;
select 'Private resource RLS checks passed';
