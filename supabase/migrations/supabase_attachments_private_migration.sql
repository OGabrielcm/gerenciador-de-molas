-- Anexos privados — corrige a exposição do Bloco 4.
--
-- Antes: qualquer conta lia os metadados de TODOS os anexos (SELECT using true),
-- o bucket era público e o INSERT não conferia o dono da task.
-- Agora: só o dono da task lê, sobe e apaga. O app exibe os arquivos por
-- signed URL (attachments-service.ts), não mais por URL pública.
--
-- ORDEM DE DEPLOY: publique o front com signed URLs ANTES de aplicar esta
-- migration. Signed URL funciona em bucket público; URL pública não funciona
-- em bucket privado.
--
-- Idempotente. Os objetos existentes continuam acessíveis ao dono, porque o
-- caminho já é `${task_id}/${uuid}-${nome}`.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabela public.attachments — tudo restrito ao dono
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists attachments_select_auth on public.attachments;
drop policy if exists attachments_select_own on public.attachments;
create policy attachments_select_own on public.attachments
  for select to authenticated
  using (auth.uid() = user_id);

-- INSERT: além de user_id = uid, a task precisa ser do próprio usuário.
drop policy if exists attachments_insert_own on public.attachments;
create policy attachments_insert_own on public.attachments
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.tasks t
      where t.id = task_id and t.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Bucket privado
-- ─────────────────────────────────────────────────────────────────────────────
update storage.buckets set public = false where id = 'attachments';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. storage.objects — a primeira pasta do caminho é o id da task, e a task
--    precisa ser do usuário. Vale para ler (signed URL) e para subir.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists attachments_objects_select on storage.objects;
create policy attachments_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.tasks t
      where t.id::text = (storage.foldername(name))[1]
        and t.user_id = auth.uid()
    )
  );

drop policy if exists attachments_objects_insert on storage.objects;
create policy attachments_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.tasks t
      where t.id::text = (storage.foldername(name))[1]
        and t.user_id = auth.uid()
    )
  );

-- DELETE continua como estava: só quem subiu o arquivo (owner_id).
