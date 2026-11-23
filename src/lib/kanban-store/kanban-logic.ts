// Lógica de domínio PURA do kanban-store — sem React, sem Supabase.
// Extraída VERBATIM dos closures do provider.tsx para que as três
// computações não-triviais (cálculo de ordem no reorder, cascata cruzada
// ao deletar track/column) sejam testáveis isoladamente. O provider passa
// a apenas orquestrar: chama estas funções, aplica o estado e persiste.
import {
  Card,
  Column,
  ColumnId,
  Track,
  TrackId,
  columnsForTrack,
  isDoneCard,
} from "../kanban-types";

// Tolerância para comparar `order` (float) — ver Card.order em kanban-types.
const ORDER_EPSILON = 1e-9;

export interface ReorderResult {
  col: ColumnId;
  track: TrackId;
  order: number;
}

// Calcula o novo (col, track, order) de um card arrastado. Espelha a lógica
// de reorderCard. Retorna `null` quando a operação deve ser abortada:
//   - card inexistente;
//   - beforeId/afterId não encontrados na coluna alvo (âncora inválida);
//   - nenhuma mudança real (mesma col, mesma track, mesmo order).
export function computeReorderOrder(
  cards: Card[],
  id: string,
  target: { col?: ColumnId; track?: TrackId; beforeId?: string; afterId?: string },
): ReorderResult | null {
  const card = cards.find((c) => c.id === id);
  if (!card) return null;
  const targetCol = target.col ?? card.col;
  const targetTrack = target.track ?? card.track;
  // Cards da coluna alvo, ordenados, excluindo o próprio card movido.
  const sameColumn = cards
    .filter((c) => c.track === targetTrack && c.col === targetCol && c.id !== id)
    .sort((a, b) => a.order - b.order);

  let newOrder: number;
  if (target.beforeId) {
    const beforeIdx = sameColumn.findIndex((c) => c.id === target.beforeId);
    if (beforeIdx === -1) return null;
    const before = sameColumn[beforeIdx];
    const prev = sameColumn[beforeIdx - 1];
    newOrder = prev ? (prev.order + before.order) / 2 : before.order - 1;
  } else if (target.afterId) {
    const afterIdx = sameColumn.findIndex((c) => c.id === target.afterId);
    if (afterIdx === -1) return null;
    const after = sameColumn[afterIdx];
    const next = sameColumn[afterIdx + 1];
    newOrder = next ? (after.order + next.order) / 2 : after.order + 1;
  } else {
    // Sem âncora: vai pro final da coluna alvo.
    newOrder = sameColumn.length ? sameColumn[sameColumn.length - 1].order + 1 : 1;
  }

  const colChanged = targetCol !== card.col;
  const trackChanged = targetTrack !== card.track;
  const orderChanged = Math.abs(newOrder - card.order) > ORDER_EPSILON;
  if (!colChanged && !trackChanged && !orderChanged) return null;

  return { col: targetCol, track: targetTrack, order: newOrder };
}

// Resultado de uma deleção em cascata (track ou column). Carrega tanto o novo
// estado local (cards/lista de entidades) quanto o ESCOPO da persistência:
//   - movedCardIds   → cards órfãos REATRIBUÍDOS (o novo track/col/order de cada
//                      um está em `cards`; o provider persiste card a card);
//   - deletedCardIds → cards órfãos sem destino válido, REMOVIDOS.
// fallbackId: na track, a track de destino (null = não sobrou track); na
// column, a primeira coluna restante da mesma área da coluna deletada (null =
// a área ficou sem colunas). O destino real de cada card está em `cards`.
export interface CascadeDeletionResult<T> {
  cards: Card[];
  remaining: T[];
  fallbackId: string | null;
  movedCardIds: string[];
  deletedCardIds: string[];
}

// Aplica as realocações de órfãos: cada card vai para (track, col) de destino e
// recebe `order` no FIM da coluna de destino, preservando a ordem relativa
// entre os órfãos (sem duplicar o order de quem já está lá).
function relocateOrphans(
  cards: Card[],
  moves: Map<string, { track: TrackId; col: ColumnId }>,
  now: string,
): Card[] {
  const stayers = cards.filter((c) => !moves.has(c.id));
  const nextByDest = new Map<string, number>();
  const patched = new Map<string, Card>();
  const orphans = cards.filter((c) => moves.has(c.id)).sort((a, b) => a.order - b.order);
  for (const card of orphans) {
    const dest = moves.get(card.id);
    if (!dest) continue;
    const key = `${dest.track}::${dest.col}`;
    let next = nextByDest.get(key);
    if (next === undefined) {
      const inDest = stayers.filter((c) => c.track === dest.track && c.col === dest.col);
      next = inDest.length ? Math.max(...inDest.map((c) => c.order)) + 1 : 1;
    }
    patched.set(card.id, {
      ...card,
      track: dest.track,
      col: dest.col,
      order: next,
      updated_at: now,
    });
    nextByDest.set(key, next + 1);
  }
  return cards.map((c) => patched.get(c.id) ?? c);
}

// Deleta uma track movendo seus cards para a primeira track restante: cada card
// mantém a coluna se ela existir na área de destino, senão vai para a primeira
// coluna dela; o order vai para o fim da coluna de destino. Se não houver track
// restante, apaga os cards daquela track. Espelha deleteTrack.
export function computeTrackDeletion(
  cards: Card[],
  tracks: Track[],
  columns: Column[],
  id: TrackId,
  now: string,
): CascadeDeletionResult<Track> {
  const remaining = tracks.filter((t) => t.id !== id);
  const fallback = remaining[0];
  const orphans = cards.filter((c) => c.track === id);
  if (fallback) {
    const destCols = columnsForTrack(columns, fallback.id);
    const moves = new Map<string, { track: TrackId; col: ColumnId }>();
    for (const c of orphans) {
      const col = destCols.some((dc) => dc.id === c.col) ? c.col : (destCols[0]?.id ?? c.col);
      moves.set(c.id, { track: fallback.id, col });
    }
    return {
      cards: relocateOrphans(cards, moves, now),
      remaining,
      fallbackId: fallback.id,
      movedCardIds: orphans.map((c) => c.id),
      deletedCardIds: [],
    };
  }
  return {
    cards: cards.filter((c) => c.track !== id),
    remaining,
    fallbackId: null,
    movedCardIds: [],
    deletedCardIds: orphans.map((c) => c.id),
  };
}

// Deleta uma column movendo cada card dela para a primeira coluna que a ÁREA
// DO CARD mostra depois da deleção (uma coluna global pode ter cards de várias
// áreas); o order vai para o fim da coluna de destino. Card cuja área ficou
// sem nenhuma coluna é apagado. Espelha deleteColumn.
export function computeColumnDeletion(
  cards: Card[],
  columns: Column[],
  id: ColumnId,
  now: string,
): CascadeDeletionResult<Column> {
  const deleted = columns.find((c) => c.id === id);
  const remaining = columns.filter((c) => c.id !== id);
  const orphans = cards.filter((c) => c.col === id);
  const moves = new Map<string, { track: TrackId; col: ColumnId }>();
  const deletedCardIds: string[] = [];
  for (const c of orphans) {
    const dest = columnsForTrack(remaining, c.track)[0];
    if (dest) moves.set(c.id, { track: c.track, col: dest.id });
    else deletedCardIds.push(c.id);
  }
  const scopeFallback = deleted?.track_id
    ? columnsForTrack(remaining, deleted.track_id)[0]
    : remaining.filter((c) => !c.track_id).sort((a, b) => a.order - b.order)[0];
  const deletedSet = new Set(deletedCardIds);
  return {
    cards: relocateOrphans(
      cards.filter((c) => !deletedSet.has(c.id)),
      moves,
      now,
    ),
    remaining,
    fallbackId: scopeFallback?.id ?? null,
    movedCardIds: orphans.filter((c) => moves.has(c.id)).map((c) => c.id),
    deletedCardIds,
  };
}

// Move a track `id` para antes/depois de `targetId` e renumera `order` como
// 0..n-1 (tracks.order é integer no banco, não dá para usar ponto médio como
// nos cards). Retorna `null` quando não há mudança real ou ids inválidos.
export function computeTrackReorder(
  tracks: Track[],
  id: TrackId,
  targetId: TrackId,
  position: "before" | "after",
): Track[] | null {
  if (id === targetId) return null;
  const sorted = [...tracks].sort((a, b) => a.order - b.order);
  const moving = sorted.find((t) => t.id === id);
  if (!moving || !sorted.some((t) => t.id === targetId)) return null;
  const rest = sorted.filter((t) => t.id !== id);
  const targetIdx = rest.findIndex((t) => t.id === targetId);
  rest.splice(position === "before" ? targetIdx : targetIdx + 1, 0, moving);
  if (rest.every((t, i) => t.id === sorted[i].id)) return null;
  return rest.map((t, i) => ({ ...t, order: i }));
}

export function getVisibleTracks(
  tracks: Track[],
  filteredCards: Card[],
  selectedAreaIds: string[],
  search: string,
): Track[] {
  const selected = new Set(selectedAreaIds);
  const hasSearch = search.trim().length > 0;

  return tracks
    .filter((track) => selected.size === 0 || selected.has(track.id))
    .filter((track) => !hasSearch || filteredCards.some((card) => card.track === track.id));
}

// Filtro "Hoje" da home: cards com prazo hoje (inclusive os já concluídos, para
// o usuário ver o que fechou no dia) e cards vencidos que ainda não estão
// na coluna final da área. `todayIso` é a data local "YYYY-MM-DD" (passada de
// fora para testar).
export function isDueTodayOrOverdue(card: Card, todayIso: string, columns: Column[]): boolean {
  if (!card.date) return false;
  if (card.date === todayIso) return true;
  return card.date < todayIso && !isDoneCard(card, columns);
}
