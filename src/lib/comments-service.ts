import { supabase } from "./supabase";
import type { Comment } from "./kanban-types";

type SetComments = React.Dispatch<React.SetStateAction<Record<string, Comment[]>>>;

export async function fetchComments(cardId: string): Promise<Comment[]> {
  const { data } = await supabase
    .from("comments")
    .select("*")
    .eq("task_id", cardId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Comment[];
}

export async function addComment(
  setComments: SetComments,
  userId: string,
  cardId: string,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const { data, error } = await supabase
    .from("comments")
    .insert({ task_id: cardId, user_id: userId, text: trimmed })
    .select()
    .single();
  if (!error && data) {
    setComments((cur) => ({
      ...cur,
      [cardId]: [data as Comment, ...(cur[cardId] ?? [])],
    }));
  }
}

export async function updateComment(
  setComments: SetComments,
  commentId: string,
  text: string,
): Promise<void> {
  const now = new Date().toISOString();
  const trimmed = text.trim();
  let previous: Comment | undefined;
  setComments((cur) => {
    const next: Record<string, Comment[]> = {};
    for (const k of Object.keys(cur)) {
      next[k] = cur[k].map((c) => {
        if (c.id !== commentId) return c;
        previous = c;
        return { ...c, text: trimmed, updated_at: now };
      });
    }
    return next;
  });
  const { error } = await supabase
    .from("comments")
    .update({ text: trimmed, updated_at: now })
    .eq("id", commentId);
  if (error && previous) {
    // rollback: restaura o comentário anterior
    console.error("Falha ao editar comentário:", error);
    const prev = previous;
    setComments((cur) => {
      const next: Record<string, Comment[]> = {};
      for (const k of Object.keys(cur)) {
        next[k] = cur[k].map((c) => (c.id === commentId ? prev : c));
      }
      return next;
    });
  }
}

export async function deleteComment(
  setComments: SetComments,
  commentId: string,
  cardId: string,
): Promise<void> {
  let removed: Comment | undefined;
  setComments((cur) => {
    removed = (cur[cardId] ?? []).find((c) => c.id === commentId);
    return {
      ...cur,
      [cardId]: (cur[cardId] ?? []).filter((c) => c.id !== commentId),
    };
  });
  const { error } = await supabase.from("comments").delete().eq("id", commentId);
  if (error && removed) {
    // rollback: devolve o comentário (ordem created_at desc)
    console.error("Falha ao excluir comentário:", error);
    const restored = removed;
    setComments((cur) => ({
      ...cur,
      [cardId]: [...(cur[cardId] ?? []).filter((c) => c.id !== commentId), restored].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      ),
    }));
  }
}
