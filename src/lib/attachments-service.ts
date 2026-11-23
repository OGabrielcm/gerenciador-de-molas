import { supabase } from "./supabase";
import type { Attachment } from "./kanban-types";

type SetAttachments = React.Dispatch<React.SetStateAction<Record<string, Attachment[]>>>;

const BUCKET = "attachments";

const SIGNED_URL_TTL_SECONDS = 60 * 60;

// O bucket é privado: os arquivos são exibidos/baixados por signed URL, que só
// o dono da task consegue gerar (RLS em storage.objects). Devolve path → URL;
// um path sem URL (erro ou sem permissão) simplesmente fica fora do mapa.
export async function fetchAttachmentUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return {};
  const urls: Record<string, string> = {};
  for (const item of data) {
    if (item.path && item.signedUrl && !item.error) urls[item.path] = item.signedUrl;
  }
  return urls;
}

export async function fetchAttachments(cardId: string): Promise<Attachment[]> {
  const { data } = await supabase
    .from("attachments")
    .select("*")
    .eq("task_id", cardId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Attachment[];
}

// Sobe o binário PRIMEIRO no Storage; só então grava a row de metadados.
// Se o upload falhar, nada é inserido. Se a row falhar, removemos o objeto
// para não deixar lixo no bucket. Caminho: `${cardId}/${uuid}-${nome}`.
export async function addAttachment(
  setAttachments: SetAttachments,
  userId: string,
  cardId: string,
  file: File,
): Promise<void> {
  const safeName = file.name.replace(/[^\w.-]+/g, "_");
  const path = `${cardId}/${crypto.randomUUID()}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (upErr) return;

  const { data, error } = await supabase
    .from("attachments")
    .insert({
      task_id: cardId,
      user_id: userId,
      path,
      name: file.name,
      mime: file.type || null,
      size_bytes: file.size,
    })
    .select()
    .single();

  if (error || !data) {
    // rollback do objeto para não orfanar arquivo sem metadados
    await supabase.storage.from(BUCKET).remove([path]);
    return;
  }

  setAttachments((cur) => ({
    ...cur,
    [cardId]: [data as Attachment, ...(cur[cardId] ?? [])],
  }));
}

// Remove o OBJETO do Storage primeiro; só apaga a row se o storage saiu (ou
// já não existia). Critério do Bloco 4: o delete tem que limpar o arquivo do
// storage, não só o registro no banco.
export async function deleteAttachment(
  setAttachments: SetAttachments,
  attachment: Attachment,
): Promise<void> {
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove([attachment.path]);
  // Se o storage falhou de verdade, não apaga a row (evita registro órfão
  // apontando para arquivo que continua no bucket).
  if (rmErr) return;

  await supabase.from("attachments").delete().eq("id", attachment.id);

  setAttachments((cur) => ({
    ...cur,
    [attachment.task_id]: (cur[attachment.task_id] ?? []).filter((a) => a.id !== attachment.id),
  }));
}
