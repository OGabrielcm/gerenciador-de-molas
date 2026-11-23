import { AddCardModal } from "./AddCardModal";
import { useKanban } from "@/lib/kanban-store";

export function CreateCardModal({ onClose }: { onClose: () => void }) {
  const { trilhas, tracks, cards, templates, addCard, getColumnsForTrack } = useKanban();
  const goals = cards.filter((c) => c.type === "Goal");
  const firstTrack = tracks[0]?.id ?? "";
  const firstColumn = firstTrack ? (getColumnsForTrack(firstTrack)[0]?.id ?? "todo") : "todo";
  if (!firstTrack) {
    onClose();
    return null;
  }
  return (
    <AddCardModal
      column={firstColumn}
      track={firstTrack}
      tracks={tracks}
      trilhas={trilhas}
      goals={goals}
      templates={templates}
      allowTrackPick
      allowColPick
      onClose={onClose}
      onAdd={addCard}
    />
  );
}
