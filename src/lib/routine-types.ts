// Rotinas — tarefas semanais que viram card no board no dia marcado.
// Lógica pura aqui (testável); acesso ao Supabase em routines-service.ts.
import type { Priority } from "./kanban-types";
import type { Weekday } from "./habit-types";
import { addDays, parseLocalDate, toLocalIso } from "./date-utils";

export interface Routine {
  id: string;
  user_id: string;
  track_id: string;
  title: string;
  prio: Priority;
  weekdays: Weekday[];
  active: boolean;
  last_generated_date: string | null; // "YYYY-MM-DD"
  created_at: string;
}

// Data (YYYY-MM-DD) do card que a rotina deve gerar agora, ou null.
// Regra: o dia marcado mais recente até hoje (olha só os últimos 7 dias), que
// seja depois da última geração e não antes do dia em que a rotina foi criada.
// Semanas perdidas não acumulam: gera só a ocorrência mais recente.
export function getDueRoutineDate(
  weekdays: Weekday[],
  lastGenerated: string | null,
  createdIso: string,
  todayIso: string,
): string | null {
  if (weekdays.length === 0) return null;
  const today = parseLocalDate(todayIso);
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, -i);
    if (!weekdays.includes(d.getDay() as Weekday)) continue;
    const iso = toLocalIso(d);
    if (iso < createdIso) return null;
    if (lastGenerated && iso <= lastGenerated) return null;
    return iso;
  }
  return null;
}
