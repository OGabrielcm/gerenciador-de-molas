import { useState } from "react";
import { Archive, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useKanban } from "@/lib/kanban-store";
import { useLocale } from "@/lib/locale-context";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

export function RestoreArchivedButton({ ids }: { ids: string[] }) {
  const { restoreArchived, organizing } = useKanban();
  const { t } = useLocale();
  return (
    <button
      type="button"
      disabled={organizing}
      className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs hover:bg-muted disabled:opacity-50"
      onClick={async () => {
        try {
          await restoreArchived(ids);
          toast.success(t("archive_restored"));
        } catch {
          toast.error(t("organization_failed"));
        }
      }}
    >
      <RotateCcw className="h-3.5 w-3.5" />
      {t("restore_archive")}
    </button>
  );
}

export function ArchiveDoneButton({
  areaId,
  areaName,
  ids,
}: {
  areaId: string;
  areaName: string;
  ids: string[];
}) {
  const { archiveDone, restoreArchived, organizing } = useKanban();
  const { t } = useLocale();
  const [selection, setSelection] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  async function confirm() {
    if (!selection || organizing) return;
    setError(false);
    try {
      const archived = await archiveDone(areaId, selection);
      setSelection(null);
      toast.success(t("archive_saved"), {
        duration: 8000,
        action: {
          label: t("undo_archive"),
          onClick: async () => {
            try {
              await restoreArchived(archived);
              toast.success(t("archive_restored"));
            } catch {
              toast.error(t("organization_failed"));
            }
          },
        },
      });
    } catch {
      setError(true);
    }
  }
  return (
    <>
      <button
        type="button"
        disabled={organizing || ids.length === 0}
        aria-label={`${t("archive_done")}: ${areaName}`}
        title={ids.length ? t("archive_done") : t("nothing_to_archive")}
        onClick={() => {
          setSelection([...ids]);
          setError(false);
        }}
        className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
      >
        <Archive className="h-3.5 w-3.5" />
        {t("archive_done")} ({ids.length})
      </button>
      <AlertDialog
        open={selection !== null}
        onOpenChange={(open) => {
          if (!open && !organizing) setSelection(null);
        }}
      >
        <AlertDialogContent className="w-[90vw] max-w-lg rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("archive_done")} — {areaName}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selection?.length} {t("archive_confirmation")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t("organization_failed")}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={organizing}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={organizing}
              onClick={(event) => {
                event.preventDefault();
                void confirm();
              }}
            >
              {organizing ? t("organization_saving") : t("archive_done")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
