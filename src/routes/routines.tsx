import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Pause, Play, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/shell/AppShell";
import { useKanban } from "@/lib/kanban-store";
import { useAuth } from "@/lib/auth-store";
import { useLocale } from "@/lib/locale-context";
import type { Weekday } from "@/lib/habit-types";
import { PRIORITIES, type Priority } from "@/lib/kanban-types";
import type { Routine } from "@/lib/routine-types";
import {
  addRoutine,
  deleteRoutine,
  fetchRoutines,
  generateDueRoutineCards,
  setRoutineActive,
} from "@/lib/routines-service";

export const Route = createFileRoute("/routines")({
  component: RoutinesPage,
  head: () => ({ meta: [{ title: "Rotinas — Molas" }] }),
});

const WEEKDAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function RoutinesPage() {
  const { tracks, addCard, getColumnsForTrack } = useKanban();
  const { t, locale } = useLocale();
  const WEEKDAYS = locale === "pt" ? WEEKDAYS_PT : WEEKDAYS_EN;
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchRoutines().then((list) => {
      setRoutines(list);
      setLoading(false);
    });
  }, []);

  // Rotina nova marcada para hoje já gera o card agora (a reserva no banco
  // impede duplicar as que já foram geradas).
  const generateNow = async () => {
    await generateDueRoutineCards({
      trackIds: new Set(tracks.map((tr) => tr.id)),
      firstColumnFor: (id) => getColumnsForTrack(id)[0]?.id,
      addCard,
    });
    setRoutines(await fetchRoutines());
  };

  const toggleActive = async (r: Routine) => {
    setRoutines((cur) => cur.map((x) => (x.id === r.id ? { ...x, active: !r.active } : x)));
    if (!(await setRoutineActive(r.id, !r.active))) {
      setRoutines((cur) => cur.map((x) => (x.id === r.id ? r : x)));
    }
  };

  const remove = async (r: Routine) => {
    if (!confirm(t("routine_delete_confirm"))) return;
    setRoutines((cur) => cur.filter((x) => x.id !== r.id));
    if (!(await deleteRoutine(r.id))) setRoutines((cur) => [...cur, r]);
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{t("routines_title")}</h2>
            <p className="text-xs text-muted-foreground">{t("routine_hint")}</p>
          </div>
          <button
            onClick={() => setAdding((v) => !v)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("routine_add")}
          </button>
        </div>

        {adding && (
          <AddRoutineForm
            weekdayLabels={WEEKDAYS}
            onClose={() => setAdding(false)}
            onCreated={async (r) => {
              setRoutines((cur) => [...cur, r]);
              setAdding(false);
              await generateNow();
            }}
          />
        )}

        {loading ? (
          <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            {t("routine_loading")}
          </p>
        ) : routines.length === 0 && !adding ? (
          <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            {t("routine_empty")}
          </p>
        ) : (
          <div className="space-y-2">
            {routines.map((r) => {
              const track = tracks.find((tr) => tr.id === r.track_id);
              const days = [...r.weekdays]
                .sort()
                .map((d) => WEEKDAYS[d])
                .join(", ");
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
                  style={{ opacity: r.active ? 1 : 0.55 }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {track?.name ?? "—"} · {days} · {r.prio}
                      {!r.active && ` · ${t("routine_paused")}`}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleActive(r)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted"
                    aria-label={r.active ? t("routine_pause") : t("routine_resume")}
                    title={r.active ? t("routine_pause") : t("routine_resume")}
                  >
                    {r.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => remove(r)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-red-600"
                    aria-label={t("routine_delete")}
                    title={t("routine_delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function AddRoutineForm({
  weekdayLabels,
  onClose,
  onCreated,
}: {
  weekdayLabels: string[];
  onClose: () => void;
  onCreated: (r: Routine) => void;
}) {
  const { tracks } = useKanban();
  const { user } = useAuth();
  const { t } = useLocale();
  const [title, setTitle] = useState("");
  const [trackId, setTrackId] = useState(tracks[0]?.id ?? "");
  const [days, setDays] = useState<Weekday[]>([new Date().getDay() as Weekday]);
  const [prio, setPrio] = useState<Priority>("Média");
  const [saving, setSaving] = useState(false);

  const toggleDay = (d: Weekday) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  const canSave = title.trim() && trackId && days.length > 0 && user && !saving;

  const submit = async () => {
    if (!canSave || !user) return;
    setSaving(true);
    const created = await addRoutine({
      userId: user.id,
      trackId,
      title,
      prio,
      weekdays: [...days].sort(),
    });
    setSaving(false);
    if (created) onCreated(created);
    else toast.error(t("routine_create_error"));
  };

  const fieldClass =
    "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40";

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{t("routine_add")}</p>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          aria-label={t("cancel")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={t("routine_name_placeholder")}
        autoFocus
        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
      />

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-muted-foreground">
          {t("routine_area")}
          <select
            value={trackId}
            onChange={(e) => setTrackId(e.target.value)}
            className={fieldClass}
          >
            {tracks.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          {t("routine_priority")}
          <select
            value={prio}
            onChange={(e) => setPrio(e.target.value as Priority)}
            className={fieldClass}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("routine_days")}</p>
        <div className="flex flex-wrap gap-1.5">
          {weekdayLabels.map((label, idx) => {
            const d = idx as Weekday;
            const on = days.includes(d);
            return (
              <button
                key={idx}
                onClick={() => toggleDay(d)}
                aria-pressed={on}
                className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: on ? "var(--foreground)" : "transparent",
                  color: on ? "var(--background)" : "var(--muted-foreground)",
                  border: `0.5px solid ${on ? "var(--foreground)" : "var(--border)"}`,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={!canSave}
          className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-40"
        >
          {t("routine_create")}
        </button>
      </div>
    </div>
  );
}
