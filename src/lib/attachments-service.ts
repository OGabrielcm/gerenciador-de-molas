import { supabase } from "./supabase";
import type { Attachment } from "./kanban-types";

type SetAttachments = React.Dispatch<React.SetStateAction<Record<string, Attachment[]>>>;

const BUCKET = "attachments";

// Private objects are readable only after Storage authorizes the current user.
export async function attachmentSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error("Não foi possível abrir o anexo.");
  return data.signedUrl;
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
  if (upErr) throw new Error("Não foi possível enviar o anexo. Tente novamente.");

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
    throw new Error("Não foi possível registrar o anexo. Tente novamente.");
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
  if (rmErr) throw new Error("Não foi possível remover o arquivo. Tente novamente.");

  const { data, error } = await supabase
    .from("attachments")
    .delete()
    .eq("id", attachment.id)
    .select("id");
  if (error || !data?.length)
    throw new Error("O registro do anexo não foi removido. Atualize e tente novamente.");

  setAttachments((cur) => ({
    ...cur,
    [attachment.task_id]: (cur[attachment.task_id] ?? []).filter((a) => a.id !== attachment.id),
  }));
}
