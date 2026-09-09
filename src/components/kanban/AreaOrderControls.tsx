import { ArrowUp, ArrowDown, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useKanban } from "@/lib/kanban-store";
import { useLocale } from "@/lib/locale-context";
import { moveArea } from "@/lib/area-order";

export function AreaOrderControls({ areaId, name }: { areaId: string; name: string }) {
  const { tracks, reorderTracks, organizing } = useKanban();
  const { t } = useLocale();
  const ids = tracks.map((track) => track.id);
  const index = ids.indexOf(areaId);
  async function move(offset: number) {
    try {
      await reorderTracks(moveArea(ids, areaId, ids[index + offset]));
      toast.success(t("area_order_saved"));
    } catch {
      toast.error(t("organization_failed"));
    }
  }
  const style =
    "flex h-11 w-9 items-center justify-center rounded-md hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-current disabled:opacity-30";
  return (
    <div className="flex shrink-0" role="group" aria-label={`${t("move_area")}: ${name}`}>
      <button
        type="button"
        className={style + " cursor-grab active:cursor-grabbing"}
        disabled={organizing || ids.length < 2}
        draggable={!organizing && ids.length > 1}
        aria-label={`${t("drag_area")}: ${name}`}
        title={t("drag_area")}
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.setData("application/x-molas-area", areaId);
          event.dataTransfer.effectAllowed = "move";
        }}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={style}
        disabled={organizing || index <= 0}
        aria-label={`${t("move_area_up")}: ${name}`}
        onClick={() => void move(-1)}
      >
        <ArrowUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={style}
        disabled={organizing || index < 0 || index === ids.length - 1}
        aria-label={`${t("move_area_down")}: ${name}`}
        onClick={() => void move(1)}
      >
        <ArrowDown className="h-4 w-4" />
      </button>
    </div>
  );
}
