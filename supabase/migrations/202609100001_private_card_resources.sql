-- Private card resources. Apply after the legacy attachment/activity migrations.
-- Restrictive guards combine with legacy permissive policies rather than relying on names.
begin;
update storage.buckets set public = false where id = 'attachments';

drop policy if exists attachments_parent_owner_guard on public.attachments;
create policy attachments_parent_owner_guard on public.attachments
 as restrictive for all to authenticated
 using (user_id = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid()))) with check (user_id = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid())));

drop policy if exists comments_parent_owner_guard on public.comments;
create policy comments_parent_owner_guard on public.comments
 as restrictive for all to authenticated
 using (user_id = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid()))) with check (user_id = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid())));

drop policy if exists activities_parent_owner_guard on public.activities;
create policy activities_parent_owner_guard on public.activities
 as restrictive for all to authenticated
 using (user_id = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid()))) with check (user_id = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid())));

drop policy if exists time_logs_parent_owner_guard on public.time_logs;
create policy time_logs_parent_owner_guard on public.time_logs
 as restrictive for all to authenticated
 using (user_id = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid()))) with check (user_id = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid())));

drop policy if exists attachments_private_object_guard on storage.objects;
create policy attachments_private_object_guard on storage.objects
 as restrictive for all to authenticated
 using (bucket_id <> 'attachments' or exists (
   select 1 from public.tasks t where t.id::text = (storage.foldername(name))[1]
   and t.user_id = (select auth.uid())
 ))
 with check (bucket_id <> 'attachments' or exists (
   select 1 from public.tasks t where t.id::text = (storage.foldername(name))[1]
   and t.user_id = (select auth.uid())
 ));
drop policy if exists attachments_no_anonymous_objects on storage.objects;
create policy attachments_no_anonymous_objects on storage.objects
 as restrictive for all to anon
 using (bucket_id <> 'attachments') with check (bucket_id <> 'attachments');
commit;
