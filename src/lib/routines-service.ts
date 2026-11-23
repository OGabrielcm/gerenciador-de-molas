// Acesso ao Supabase das rotinas + geração dos cards da semana.
import { supabase } from "./supabase";
import type { Routine } from "./routine-types";
import { getDueRoutineDate } from "./routine-types";
import type { Weekday } from "./habit-types";
import type { Priority } from "./kanban-types";
import type { AddInput } from "./kanban-store/context";
import { toLocalIso } from "./date-utils";

// Erro (ex.: tabela ainda não criada) vira lista vazia — nunca quebra o board.
export async function fetchRoutines(): Promise<Routine[]> {
  const { data, error } = await supabase
    .from("routines")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[routines] Falha ao carregar rotinas:", error.message);
    return [];
  }
  return (data ?? []) as Routine[];
}

export async function addRoutine(input: {
  userId: string;
  trackId: string;
  title: string;
  prio: Priority;
  weekdays: Weekday[];
}): Promise<Routine | null> {
  const { data, error } = await supabase
    .from("routines")
    .insert({
      user_id: input.userId,
      track_id: input.trackId,
      title: input.title.trim(),
      prio: input.prio,
      weekdays: input.weekdays,
      active: true,
    })
    .select()
    .single();
  if (error) {
    console.error("[routines] Falha ao criar rotina:", error.message);
    return null;
  }
  return data as Routine;
}

export async function setRoutineActive(id: string, active: boolean): Promise<boolean> {
  const { error } = await supabase.from("routines").update({ active }).eq("id", id);
  return !error;
}

export async function deleteRoutine(id: string): Promise<boolean> {
  const { error } = await supabase.from("routines").delete().eq("id", id);
  return !error;
}

// Reserva a data da rotina. Só uma aba/dispositivo consegue: o UPDATE é
// condicional e devolve a linha apenas para quem gravou primeiro.
async function claimRoutineDate(routine: Routine, date: string): Promise<boolean> {
  let q = supabase.from("routines").update({ last_generated_date: date }).eq("id", routine.id);
  q = routine.last_generated_date
    ? q.lt("last_generated_date", date)
    : q.is("last_generated_date", null);
  const { data, error } = await q.select("id");
  return !error && (data?.length ?? 0) > 0;
}

// Cria os cards das rotinas que vencem hoje (ou cujo dia passou sem o app
// aberto). Chamado uma vez por login, depois que áreas e colunas carregaram.
export async function generateDueRoutineCards(deps: {
  trackIds: Set<string>;
  firstColumnFor: (trackId: string) => string | undefined;
  addCard: (data: AddInput) => void | Promise<void>;
}): Promise<void> {
  const routines = await fetchRoutines();
  const todayIso = toLocalIso(new Date());
  for (const r of routines) {
    if (!r.active || !deps.trackIds.has(r.track_id)) continue;
    const createdIso = toLocalIso(new Date(r.created_at));
    const date = getDueRoutineDate(r.weekdays, r.last_generated_date, createdIso, todayIso);
    if (!date) continue;
    const col = deps.firstColumnFor(r.track_id);
    if (!col) continue;
    if (!(await claimRoutineDate(r, date))) continue;
    await deps.addCard({
      col,
      track: r.track_id,
      type: "Task",
      title: r.title,
      prio: r.prio,
      date,
      tags: [],
    });
  }
}
