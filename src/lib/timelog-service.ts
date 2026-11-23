import { supabase } from "./supabase";
import { toLocalIso } from "./date-utils";
import type { TimeLog } from "./kanban-types";

type SetTimeLogs = React.Dispatch<React.SetStateAction<Record<string, TimeLog[]>>>;

export async function fetchTimeLogs(cardId: string): Promise<TimeLog[]> {
  const { data } = await supabase
    .from("time_logs")
    .select("*")
    .eq("task_id", cardId)
    .order("logged_at", { ascending: false });
  return (data ?? []) as TimeLog[];
}

export async function addTimeLog(
  setTimeLogs: SetTimeLogs,
  userId: string,
  cardId: string,
  minutes: number,
  note?: string,
  loggedAt?: string,
): Promise<void> {
  if (minutes <= 0) return;
  const { data, error } = await supabase
    .from("time_logs")
    .insert({
      task_id: cardId,
      user_id: userId,
      minutes,
      note: note?.trim() || null,
      logged_at: loggedAt ?? toLocalIso(new Date()),
    })
    .select()
    .single();
  if (!error && data) {
    setTimeLogs((cur) => ({
      ...cur,
      [cardId]: [data as TimeLog, ...(cur[cardId] ?? [])],
    }));
  }
}

export async function deleteTimeLog(
  setTimeLogs: SetTimeLogs,
  logId: string,
  cardId: string,
): Promise<void> {
  let removed: TimeLog | undefined;
  setTimeLogs((cur) => {
    removed = (cur[cardId] ?? []).find((l) => l.id === logId);
    return {
      ...cur,
      [cardId]: (cur[cardId] ?? []).filter((l) => l.id !== logId),
    };
  });
  const { error } = await supabase.from("time_logs").delete().eq("id", logId);
  if (error && removed) {
    // rollback: devolve o registro (ordem logged_at desc)
    console.error("Falha ao excluir registro de tempo:", error);
    const restored = removed;
    setTimeLogs((cur) => ({
      ...cur,
      [cardId]: [...(cur[cardId] ?? []).filter((l) => l.id !== logId), restored].sort((a, b) =>
        b.logged_at.localeCompare(a.logged_at),
      ),
    }));
  }
}
