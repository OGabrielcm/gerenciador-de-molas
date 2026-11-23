import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../auth-store";
import type { Habit, HabitLog, Frequency } from "../habit-types";
import * as HabitsService from "../habits-service";
import { Ctx } from "./context";

export function HabitsProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logsByHabit, setLogsByHabit] = useState<Record<string, HabitLog[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  // Trava toggles em voo por (habitId, date) — evita insert duplicado no duplo clique.
  const togglingRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setHabits([]);
      setLogsByHabit({});
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await HabitsService.fetchHabits();
        if (cancelled) return;
        // Uma query só para os logs de todos os hábitos (sem N+1).
        const map = await HabitsService.fetchLogsForHabits(list.map((h) => h.id));
        if (cancelled) return;
        setHabits(list);
        setLogsByHabit(map);
      } catch (e) {
        if (cancelled) return;
        console.error("Falha ao carregar hábitos:", e);
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (!inFlightRef.current) {
      inFlightRef.current = run().finally(() => {
        inFlightRef.current = null;
      });
    }

    return () => {
      cancelled = true;
    };
    // Chaveia por user?.id (primitivo estável), não pelo objeto user — mesma
    // lição do Bloco 2.1 (Supabase recria user a cada setSession).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);

  const addHabit = async (name: string, color: string, frequency: Frequency) => {
    if (!user) return;
    await HabitsService.addHabit(setHabits, user.id, name, color, frequency);
  };

  const deleteHabit = async (habitId: string) => {
    await HabitsService.deleteHabit(
      setHabits,
      setLogsByHabit,
      habitId,
      habits.find((h) => h.id === habitId),
      logsByHabit[habitId] ?? [],
    );
  };

  const toggleLog = async (habitId: string, date: string) => {
    if (!user) return;
    const key = `${habitId}|${date}`;
    if (togglingRef.current.has(key)) return;
    togglingRef.current.add(key);
    try {
      await HabitsService.toggleLog(
        setLogsByHabit,
        logsByHabit[habitId] ?? [],
        user.id,
        habitId,
        date,
      );
    } finally {
      togglingRef.current.delete(key);
    }
  };

  const value = useMemo(
    () => ({ habits, logsByHabit, loading, error, addHabit, deleteHabit, toggleLog }),
    // addHabit/deleteHabit/toggleLog são closures estáveis o suficiente; o que
    // muda o value é o estado (habits/logsByHabit/loading).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [habits, logsByHabit, loading, error],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
