// Kernel do KanbanProvider: entidades (cards/tracks/trilhas/columns) +
// estado de UI (filter/selectedAreaIds/collapsed/search/createOpen/loading) +
// efeito de load + TODAS as ações que tocam essas entidades. Mantido junto DE
// PROPÓSITO: as ações de delete cruzam domínios (deleteTrack mexe em cards/
// selectedAreaIds/collapsed; deleteTrilha em cards/filter), então separá-las
// criaria acoplamento via setters injetados.
//
// ARQUITETURA (refatorado): as ações do kernel são memoizadas UMA vez (deps
// `[]`) e leem o estado SEMPRE fresco através de `stateRef`/`slicesRef`, em vez
// de capturá-lo por closure. Isso elimina o antigo array de dependências manual
// (com `eslint-disable`) que era o footgun real: adicionar uma ação que lê um
// novo pedaço de estado e esquecer de listá-lo dava closure obsoleta, bug
// silencioso, zero erro de compilação. Agora `value` só depende de DADOS
// reativos reais — sem `eslint-disable`, sem closure presa.
//
// Persistência isolada em kanban-repo.ts; lógica não-trivial (ordem do reorder,
// cascata de delete) em kanban-logic.ts (testada). Slices independentes
// (card-details, templates, card-colors) compostos via hooks.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { generateDueRoutineCards } from "../routines-service";
import {
  Card,
  Column,
  Track,
  Trilha,
  columnsForTrack,
  loadCollapsed,
  saveCollapsed,
} from "../kanban-types";
import { useAuth } from "../auth-store";
import { Ctx, KanbanCtx } from "./context";
import {
  nextOrder,
  rowToCard,
  rowToColumn,
  rowToTrack,
  rowToTrilha,
  trackToRow,
} from "./kanban-mappers";
import {
  computeColumnDeletion,
  computeReorderOrder,
  computeTrackDeletion,
  computeTrackReorder,
} from "./kanban-logic";
import { kanbanRepo } from "./kanban-repo";
import { useCardDetails } from "./use-card-details";
import { useTemplates } from "./use-templates";
import { useCardColors } from "./use-card-colors";

// Persiste, card a card, o novo track/col/order dos órfãos de uma deleção em
// cascata (cada um pode ter destino e order próprios). Devolve os ids cujo
// update falhou (vazio = tudo salvo).
async function persistMovedCards(after: Card[], movedIds: string[]): Promise<Set<string>> {
  const moved = movedIds
    .map((id) => after.find((c) => c.id === id))
    .filter((c): c is Card => Boolean(c));
  const results = await Promise.all(
    moved.map((c) =>
      kanbanRepo.tasks.update(c.id, {
        track: c.track,
        col: c.col,
        order: c.order,
        updated_at: c.updated_at,
      }),
    ),
  );
  const failed = new Set<string>();
  results.forEach((r, i) => {
    if (r.error) failed.add(moved[i].id);
  });
  if (failed.size > 0) {
    const firstError = results.find((r) => r.error)?.error;
    console.error("[cascade] Falha ao mover cards no Supabase:", firstError);
  }
  return failed;
}

// Versão anterior de `card` em `before` (ou o próprio card, se não existir).
function snapshotOf(before: Card[], card: Card): Card {
  return before.find((c) => c.id === card.id) ?? card;
}

export function KanbanProvider({ children }: { children: ReactNode }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [trilhas, setTrilhas] = useState<Trilha[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("__all");
  // [] = todas as áreas. Quando há ids, o board mostra apenas essas áreas.
  // O banco ainda usa `tracks`; "Area" aqui é a nomenclatura de produto/frontend.
  const [selectedAreaIds, setSelectedAreaIds] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Incrementado por `reload` para refazer a carga (botão "Tentar de novo").
  const [reloadKey, setReloadKey] = useState(0);

  const {
    activitiesByCard,
    commentsByCard,
    timeLogsByCard,
    attachmentsByCard,
    currentUserIdRef,
    logActivity,
    loadCardDetails,
    resetCardDetails,
    addComment,
    updateComment,
    deleteComment,
    addTimeLog,
    deleteTimeLog,
    addAttachment,
    deleteAttachment,
  } = useCardDetails();
  const { templates, saveTemplate, updateTemplate, deleteTemplate } = useTemplates();
  const { cardColors, setCardColor } = useCardColors();

  // Espelho SEMPRE fresco do estado e dos slices, para que as ações estáveis
  // (memo com deps `[]`) leiam sem capturar valores antigos por closure.
  // Atualizado a cada render — barato, sincronicamente correto na fase de render.
  const stateRef = useRef({ cards, trilhas, tracks, columns });
  stateRef.current = { cards, trilhas, tracks, columns };

  const slicesRef = useRef({
    logActivity,
    loadCardDetails,
    addComment,
    updateComment,
    deleteComment,
    addTimeLog,
    deleteTimeLog,
    addAttachment,
    deleteAttachment,
    saveTemplate,
    updateTemplate,
    deleteTemplate,
    setCardColor,
  });
  slicesRef.current = {
    logActivity,
    loadCardDetails,
    addComment,
    updateComment,
    deleteComment,
    addTimeLog,
    deleteTimeLog,
    addAttachment,
    deleteAttachment,
    saveTemplate,
    updateTemplate,
    deleteTemplate,
    setCardColor,
  };

  // Bloco 2.1: consome a sessão do auth-store em vez de manter getUser()/
  // onAuthStateChange próprios. O padrão anterior tinha 3 gatilhos de load
  // (chamada direta + SIGNED_IN + load inicial) correndo sobre um único
  // loadInFlightRef cujo dedup, sob StrictMode (mount→cleanup→mount), devolvia
  // uma Promise presa ao `cancelled` da instância morta → o board travava no
  // skeleton ao restaurar sessão (reload). O auth-store já usa getSession()
  // (leitura local, sem race) e expõe user/loading; este efeito reage a eles —
  // um único gatilho, igual ao padrão de user-profile-store.
  const { user, loading: authLoading } = useAuth();
  // Cada execução do efeito de load recebe um número de sequência; só a MAIS
  // RECENTE aplica resultado/erro e encerra o loading. Substitui o antigo
  // `loadInFlightRef` + `cancelled`: com eles, uma execução nova (reload, troca
  // de conta) era pulada enquanto a anterior estava em voo, e a anterior saía
  // pelo `cancelled` sem aplicar nada → loading preso para sempre.
  const loadSeqRef = useRef(0);
  // Usuário dono do estado em memória. Quando muda (inclui logout), tudo que é
  // da conta anterior é descartado antes de carregar a nova.
  const loadedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Aguarda o auth-store hidratar a sessão antes de decidir.
    if (authLoading) return;

    const userId = user?.id ?? null;
    if (userId !== loadedUserIdRef.current) {
      loadedUserIdRef.current = userId;
      setCards([]);
      setTrilhas([]);
      setTracks([]);
      setColumns([]);
      resetCardDetails();
      setSelectedAreaIds([]);
      setFilter("__all");
      setSearch("");
    }

    // Invalida qualquer load anterior ainda em voo.
    const seq = ++loadSeqRef.current;

    // Sem usuário (sessão expirada/deslogado): estado já limpo acima; encerra o
    // loading — o guard do AppShell (!user && !loading) redireciona ao /login,
    // em vez de skeleton infinito e silencioso.
    if (!user) {
      currentUserIdRef.current = null;
      setLoadError(null);
      setLoading(false);
      return;
    }

    currentUserIdRef.current = user.id;
    setLoading(true);
    setLoadError(null);

    const runLoad = async () => {
      try {
        // Sem seed automático: trilhas, tracks, columns e cards iniciais
        // são criadas pelo usuário no Onboarding Beta (e depois em /settings).
        const {
          cards: dbCards,
          trilhas: dbTrilhas,
          tracks: dbTracks,
          columns: dbColumns,
        } = await kanbanRepo.loadAll();

        if (seq !== loadSeqRef.current) return;

        setTracks(dbTracks.map(rowToTrack));
        setCards(dbCards.map(rowToCard));
        setTrilhas(dbTrilhas.map(rowToTrilha));
        setColumns(dbColumns.map(rowToColumn).sort((a, b) => a.order - b.order));
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        console.error("[loadAll] Falha ao carregar o board:", err);
        const message = (err as { message?: unknown } | null)?.message;
        setLoadError(typeof message === "string" && message ? message : String(err));
      } finally {
        // Loading SEMPRE termina (sucesso ou erro) para a execução vigente.
        if (seq === loadSeqRef.current) setLoading(false);
      }
    };

    void runLoad();
    // Depende de user?.id (primitivo estável), NÃO do objeto `user`: o auth-store
    // recria session?.user a cada setSession (INITIAL_SESSION → SIGNED_IN →
    // TOKEN_REFRESHED no reload). Chavear pelo objeto causaria re-runs espúrios
    // (Bloco 2.1). `reloadKey` muda só via `reload`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading, reloadKey]);

  useEffect(() => {
    saveCollapsed(collapsed);
  }, [collapsed]);

  // Ações do kernel: memoizadas UMA vez. Leem estado/slices via refs (sempre
  // frescos), persistem via kanbanRepo, computam via kanban-logic. Por isso a
  // deps array é `[]` e estável — não há o que esquecer de listar.
  const actions = useMemo(
    () => ({
      addCard: async (data: Parameters<KanbanCtx["addCard"]>[0]) => {
        const userId = await kanbanRepo.getUserId();
        if (!userId) return;
        currentUserIdRef.current = userId;
        const { cards } = stateRef.current;
        const now = new Date().toISOString();
        const tempId = crypto.randomUUID();
        const newCard: Card = {
          ...data,
          starred: data.starred ?? false,
          order: nextOrder(cards, data.track, data.col),
          checklist: data.checklist ?? [],
          blocked_by: data.blocked_by ?? [],
          id: tempId,
          created_at: now,
          updated_at: now,
        };
        setCards((cur) => [...cur, newCard]);
        const { data: inserted, error } = await kanbanRepo.tasks.insert(newCard, userId);
        if (error) {
          setCards((cur) => cur.filter((c) => c.id !== tempId));
        } else if (inserted) {
          const real = rowToCard(inserted);
          setCards((cur) => cur.map((c) => (c.id === tempId ? real : c)));
          slicesRef.current.logActivity(real.id, "created", `Card criado: "${real.title}"`);
        }
      },

      updateCard: async (id: string, patch: Partial<Card>) => {
        const now = new Date().toISOString();
        const before = stateRef.current.cards.find((c) => c.id === id);
        setCards((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch, updated_at: now } : c)));
        const { error: updateError } = await kanbanRepo.tasks.update(id, {
          ...patch,
          updated_at: now,
        });
        if (updateError) {
          setCards((cur) => cur.map((c) => (c.id === id && before ? before : c)));
          console.error("[updateCard] Falha ao salvar no Supabase:", updateError);
          return;
        }
        if (before) {
          const logActivity = slicesRef.current.logActivity;
          if (patch.title !== undefined && patch.title !== before.title) {
            logActivity(id, "edited", `Título alterado para "${patch.title}"`);
          }
          if (patch.desc !== undefined && patch.desc !== before.desc) {
            logActivity(id, "edited", "Descrição atualizada");
          }
          if (patch.prio !== undefined && patch.prio !== before.prio) {
            logActivity(id, "priority", `Prioridade: ${before.prio} → ${patch.prio}`);
          }
          if (patch.date !== undefined && patch.date !== before.date) {
            logActivity(id, "deadline", patch.date ? `Prazo: ${patch.date}` : "Prazo removido");
          }
          if (patch.checklist !== undefined) {
            logActivity(id, "checklist", "Checklist atualizado");
          }
          if (patch.blocked_by !== undefined) {
            const wasBlocked = (before.blocked_by ?? []).length > 0;
            const isBlocked = (patch.blocked_by ?? []).length > 0;
            if (wasBlocked !== isBlocked) {
              logActivity(
                id,
                isBlocked ? "blocked" : "unblocked",
                isBlocked ? "Dependência adicionada" : "Dependências removidas",
              );
            }
          }
        }
      },

      moveCard: async (id: string, col: string, track?: string) => {
        const now = new Date().toISOString();
        const { cards, columns } = stateRef.current;
        const before = cards.find((c) => c.id === id);
        const targetTrack = track ?? before?.track;
        if (!targetTrack) return;
        // Card que muda de coluna/track vai pro final da nova coluna.
        const newOrder = nextOrder(
          cards.filter((c) => c.id !== id),
          targetTrack,
          col,
        );
        const patch: Partial<Card> = { col, order: newOrder, updated_at: now };
        if (track) patch.track = track;
        setCards((cur) =>
          cur.map((c) =>
            c.id === id
              ? { ...c, col, track: track ?? c.track, order: newOrder, updated_at: now }
              : c,
          ),
        );
        const { error: moveError } = await kanbanRepo.tasks.update(id, patch);
        if (moveError) {
          // Rollback optimistic update.
          setCards((cur) => cur.map((c) => (c.id === id && before ? before : c)));
          console.error("[moveCard] Falha ao salvar no Supabase:", moveError);
          return;
        }
        if (before && before.col !== col) {
          const fromName = columns.find((c) => c.id === before.col)?.name ?? before.col;
          const toName = columns.find((c) => c.id === col)?.name ?? col;
          slicesRef.current.logActivity(id, "moved", `Movido: ${fromName} → ${toName}`);
        }
      },

      reorderCard: async (id: string, target: Parameters<KanbanCtx["reorderCard"]>[1]) => {
        const { cards } = stateRef.current;
        const result = computeReorderOrder(cards, id, target);
        if (!result) return;
        const card = cards.find((c) => c.id === id);
        if (!card) return;

        const now = new Date().toISOString();
        const snapshot = card;
        setCards((cur) =>
          cur.map((c) =>
            c.id === id
              ? { ...c, col: result.col, track: result.track, order: result.order, updated_at: now }
              : c,
          ),
        );
        const { error: reorderError } = await kanbanRepo.tasks.update(id, {
          col: result.col,
          track: result.track,
          order: result.order,
          updated_at: now,
        });
        if (reorderError) {
          // Rollback optimistic update.
          setCards((cur) => cur.map((c) => (c.id === id ? snapshot : c)));
          console.error("[reorderCard] Falha ao salvar no Supabase:", reorderError);
        }
      },

      deleteCard: async (id: string) => {
        const snapshot = stateRef.current.cards.find((c) => c.id === id);
        setCards((cur) => cur.filter((c) => c.id !== id));
        const { error: deleteError } = await kanbanRepo.tasks.remove(id);
        if (deleteError) {
          // Rollback optimistic update.
          if (snapshot) setCards((cur) => [...cur, snapshot]);
          console.error("[deleteCard] Falha ao salvar no Supabase:", deleteError);
        }
      },

      toggleStar: async (id: string) => {
        const now = new Date().toISOString();
        const card = stateRef.current.cards.find((c) => c.id === id);
        if (!card) return;
        setCards((cur) =>
          cur.map((c) => (c.id === id ? { ...c, starred: !card.starred, updated_at: now } : c)),
        );
        const { error: starError } = await kanbanRepo.tasks.update(id, {
          starred: !card.starred,
          updated_at: now,
        });
        if (starError) {
          // Rollback optimistic update; sem atividade registrada.
          setCards((cur) => cur.map((c) => (c.id === id ? card : c)));
          console.error("[toggleStar] Falha ao salvar no Supabase:", starError);
          return;
        }
        slicesRef.current.logActivity(
          id,
          card.starred ? "unstarred" : "starred",
          card.starred ? "Removido dos favoritos" : "Marcado como favorito",
        );
      },

      duplicateCard: async (id: string) => {
        const userId = await kanbanRepo.getUserId();
        const original = stateRef.current.cards.find((c) => c.id === id);
        if (!userId || !original) return;
        const now = new Date().toISOString();
        const tempId = crypto.randomUUID();
        const newCard: Card = {
          ...original,
          id: tempId,
          title: `${original.title} (copy)`,
          starred: false,
          order: nextOrder(stateRef.current.cards, original.track, original.col),
          // Reseta estado de progresso: checklist desmarcado, sem dependências.
          checklist: (original.checklist ?? []).map((i) => ({
            ...i,
            id: crypto.randomUUID(),
            done: false,
          })),
          blocked_by: [],
          created_at: now,
          updated_at: now,
        };
        setCards((cur) => [...cur, newCard]);
        const { data: inserted, error } = await kanbanRepo.tasks.insert(newCard, userId);
        if (error) {
          setCards((cur) => cur.filter((c) => c.id !== tempId));
        } else if (inserted) {
          const real = rowToCard(inserted);
          setCards((cur) => cur.map((c) => (c.id === tempId ? real : c)));
          slicesRef.current.logActivity(real.id, "duplicated", `Duplicado de "${original.title}"`);
        }
      },

      toggleCollapsed: (id: string) => setCollapsed((cur) => ({ ...cur, [id]: !cur[id] })),

      getColumnsForTrack: (trackId: string) => columnsForTrack(stateRef.current.columns, trackId),

      reload: () => setReloadKey((k) => k + 1),

      createTrilha: async (t: Omit<Trilha, "id">) => {
        const userId = await kanbanRepo.getUserId();
        if (!userId) return;
        const tempId = crypto.randomUUID();
        setTrilhas((cur) => [...cur, { ...t, id: tempId }]);
        const { data: inserted, error } = await kanbanRepo.trilhas.insert(t, userId);
        if (error) {
          setTrilhas((cur) => cur.filter((x) => x.id !== tempId));
        } else if (inserted) {
          setTrilhas((cur) => cur.map((x) => (x.id === tempId ? rowToTrilha(inserted) : x)));
        }
      },

      updateTrilha: async (id: string, data: Omit<Trilha, "id">) => {
        const snapshot = stateRef.current.trilhas.find((t) => t.id === id);
        setTrilhas((cur) => cur.map((t) => (t.id === id ? { ...t, ...data } : t)));
        const { error: updateError } = await kanbanRepo.trilhas.update(id, data);
        if (updateError) {
          // Rollback optimistic update.
          if (snapshot) setTrilhas((cur) => cur.map((t) => (t.id === id ? snapshot : t)));
          console.error("[updateTrilha] Falha ao salvar no Supabase:", updateError);
        }
      },

      deleteTrilha: async (id: string) => {
        const { trilhas: trilhasSnapshot, cards: cardsSnapshot } = stateRef.current;
        setTrilhas((cur) => cur.filter((t) => t.id !== id));
        setCards((cur) => cur.map((c) => ({ ...c, tags: c.tags.filter((x) => x !== id) })));
        setFilter((f) => (f === id ? "__all" : f));
        // Cascata sem transação: se um passo falha, o seguinte não roda e o
        // estado local volta ao que o banco tem.
        const { error: removeError } = await kanbanRepo.trilhas.remove(id);
        if (removeError) {
          setTrilhas(trilhasSnapshot);
          setCards(cardsSnapshot);
          console.error("[deleteTrilha] Falha ao salvar no Supabase:", removeError);
          return;
        }
        const { error: tagError } = await kanbanRepo.trilhas.removeTagFromTasks(id);
        if (tagError) {
          // A trilha já saiu do banco, mas os cards ainda têm a tag lá.
          setCards(cardsSnapshot);
          console.error("[deleteTrilha] Falha ao remover a tag dos cards:", tagError);
        }
      },

      createTrack: async (input: Parameters<KanbanCtx["createTrack"]>[0]) => {
        const userId = await kanbanRepo.getUserId();
        if (!userId) return;
        const { tracks } = stateRef.current;
        const tempId = crypto.randomUUID();
        const order =
          input.order ?? (tracks.length ? Math.max(...tracks.map((t) => t.order)) + 1 : 0);
        const newTrack: Track = { ...input, id: tempId, order };
        setTracks((cur) => [...cur, newTrack].sort((a, b) => a.order - b.order));
        const { data: inserted, error } = await kanbanRepo.tracks.insert(
          trackToRow(newTrack),
          userId,
        );
        if (error) {
          setTracks((cur) => cur.filter((x) => x.id !== tempId));
        } else if (inserted) {
          setTracks((cur) =>
            cur
              .map((x) => (x.id === tempId ? rowToTrack(inserted) : x))
              .sort((a, b) => a.order - b.order),
          );
        }
      },

      updateTrack: async (id: string, data: Omit<Track, "id">) => {
        const snapshot = stateRef.current.tracks;
        setTracks((cur) =>
          cur.map((t) => (t.id === id ? { ...t, ...data } : t)).sort((a, b) => a.order - b.order),
        );
        const { error: updateError } = await kanbanRepo.tracks.update(id, data);
        if (updateError) {
          // Rollback optimistic update.
          setTracks(snapshot);
          console.error("[updateTrack] Falha ao salvar no Supabase:", updateError);
        }
      },

      reorderTrack: async (id: string, targetId: string, position: "before" | "after") => {
        const snapshot = stateRef.current.tracks;
        const next = computeTrackReorder(snapshot, id, targetId, position);
        if (!next) return;
        setTracks(next);
        // Só persiste as tracks cujo `order` mudou.
        const prevOrder = new Map(snapshot.map((t) => [t.id, t.order]));
        const changed = next.filter((t) => prevOrder.get(t.id) !== t.order);
        const results = await Promise.all(
          changed.map((t) => kanbanRepo.tracks.updateOrder(t.id, t.order)),
        );
        const failed = results.find((r) => r.error);
        if (failed) {
          setTracks(snapshot);
          console.error("[reorderTrack] Falha ao salvar no Supabase:", failed.error);
          // As que salvaram voltam ao order antigo (melhor esforço), para o banco
          // não ficar com a renumeração pela metade (orders repetidos).
          const saved = changed.filter((_, i) => !results[i].error);
          await Promise.all(
            saved.map((t) => kanbanRepo.tracks.updateOrder(t.id, prevOrder.get(t.id) ?? t.order)),
          );
        }
      },

      deleteTrack: async (id: string) => {
        const { cards, tracks, columns } = stateRef.current;
        const now = new Date().toISOString();
        const result = computeTrackDeletion(cards, tracks, columns, id, now);
        setCards(result.cards);
        setTracks(result.remaining);
        // Cascata sem transação: se um passo falha, o seguinte não roda e o
        // estado local volta ao que o banco tem.
        if (result.fallbackId) {
          const failedIds = await persistMovedCards(result.cards, result.movedCardIds);
          if (failedIds.size > 0) {
            // Os que salvaram já estão na track de destino no banco; só os que
            // falharam voltam (e a track volta a existir).
            setCards((cur) => cur.map((c) => (failedIds.has(c.id) ? snapshotOf(cards, c) : c)));
            setTracks(tracks);
            return;
          }
        } else {
          const { error: cardsError } = await kanbanRepo.tasks.deleteByTrack(id);
          if (cardsError) {
            setCards(cards);
            setTracks(tracks);
            console.error("[deleteTrack] Falha ao apagar os cards:", cardsError);
            return;
          }
        }
        const { error: removeError } = await kanbanRepo.tracks.remove(id);
        if (removeError) {
          // Cards já foram movidos/apagados no banco: mantém isso, só a track volta.
          setTracks(tracks);
          console.error("[deleteTrack] Falha ao salvar no Supabase:", removeError);
          return;
        }
        setSelectedAreaIds((ids) => ids.filter((areaId) => areaId !== id));
        setCollapsed((cur) => {
          const next = { ...cur };
          delete next[id];
          return next;
        });
      },

      createColumn: async (name: string, trackId?: string) => {
        const userId = await kanbanRepo.getUserId();
        if (!userId) return;
        const { columns } = stateRef.current;
        const tempId = crypto.randomUUID();
        const scopedCols = trackId
          ? columns.filter((c) => c.track_id === trackId)
          : columns.filter((c) => !c.track_id);
        const order = scopedCols.length ? Math.max(...scopedCols.map((c) => c.order)) + 1 : 5;
        const newCol: Column = { id: tempId, name: name.trim(), order, track_id: trackId };
        setColumns((cur) => [...cur, newCol].sort((a, b) => a.order - b.order));
        const { data: inserted, error } = await kanbanRepo.columns.insert({
          id: tempId,
          name: name.trim(),
          order,
          user_id: userId,
          track_id: trackId ?? null,
        });
        if (error) {
          setColumns((cur) => cur.filter((c) => c.id !== tempId));
        } else if (inserted) {
          setColumns((cur) =>
            cur
              .map((c) => (c.id === tempId ? rowToColumn(inserted) : c))
              .sort((a, b) => a.order - b.order),
          );
        }
      },

      updateColumn: async (id: string, data: { name?: string; wip_limit?: number | null }) => {
        const snapshot = stateRef.current.columns;
        const patch: Record<string, unknown> = {};
        if (data.name !== undefined) patch.name = data.name.trim();
        if (data.wip_limit !== undefined) patch.wip_limit = data.wip_limit;
        setColumns((cur) =>
          cur.map((c) =>
            c.id === id
              ? {
                  ...c,
                  ...(data.name ? { name: data.name.trim() } : {}),
                  ...(data.wip_limit !== undefined
                    ? { wip_limit: data.wip_limit ?? undefined }
                    : {}),
                }
              : c,
          ),
        );
        const { error: updateError } = await kanbanRepo.columns.update(id, patch);
        if (updateError) {
          // Rollback optimistic update.
          setColumns(snapshot);
          console.error("[updateColumn] Falha ao salvar no Supabase:", updateError);
        }
      },

      deleteColumn: async (id: string) => {
        const { cards, columns } = stateRef.current;
        const now = new Date().toISOString();
        const result = computeColumnDeletion(cards, columns, id, now);
        setCards(result.cards);
        setColumns(result.remaining);
        // Cascata sem transação: se um passo falha, o seguinte não roda e o
        // estado local volta ao que o banco tem.
        const failedIds = await persistMovedCards(result.cards, result.movedCardIds);
        if (failedIds.size > 0) {
          // Os que salvaram já estão na coluna de destino no banco; os que
          // falharam voltam, e nada é apagado.
          setCards((cur) => {
            const restored = cur.map((c) => (failedIds.has(c.id) ? snapshotOf(cards, c) : c));
            const gone = cards.filter((c) => result.deletedCardIds.includes(c.id));
            return [...restored, ...gone];
          });
          setColumns(columns);
          return;
        }
        const deleteResults = await Promise.all(
          result.deletedCardIds.map((cardId) => kanbanRepo.tasks.remove(cardId)),
        );
        const deleteFailed = deleteResults.find((r) => r.error);
        if (deleteFailed) {
          // Os movidos ficam; volta a coluna e os cards cuja remoção falhou.
          const notDeleted = new Set(
            result.deletedCardIds.filter((_, i) => deleteResults[i].error),
          );
          setCards((cur) => [...cur, ...cards.filter((c) => notDeleted.has(c.id))]);
          setColumns(columns);
          console.error("[deleteColumn] Falha ao apagar os cards:", deleteFailed.error);
          return;
        }
        const { error: removeError } = await kanbanRepo.columns.remove(id);
        if (removeError) {
          // Cards já foram movidos/apagados no banco: mantém isso, só a coluna volta.
          setColumns(columns);
          console.error("[deleteColumn] Falha ao salvar no Supabase:", removeError);
        }
      },

      // Pass-throughs estáveis para os slices (delegam via ref → sempre frescos).
      saveTemplate: (card: Card, name: string) => slicesRef.current.saveTemplate(card, name),
      updateTemplate: (templateId: string, name: string) =>
        slicesRef.current.updateTemplate(templateId, name),
      deleteTemplate: (templateId: string) => slicesRef.current.deleteTemplate(templateId),
      setCardColor: (cardId: string, color: string) =>
        slicesRef.current.setCardColor(cardId, color),
      loadCardDetails: (cardId: string) => slicesRef.current.loadCardDetails(cardId),
      addComment: (cardId: string, text: string) => slicesRef.current.addComment(cardId, text),
      updateComment: (commentId: string, text: string) =>
        slicesRef.current.updateComment(commentId, text),
      deleteComment: (commentId: string, cardId: string) =>
        slicesRef.current.deleteComment(commentId, cardId),
      addTimeLog: (cardId: string, minutes: number, note?: string, loggedAt?: string) =>
        slicesRef.current.addTimeLog(cardId, minutes, note, loggedAt),
      deleteTimeLog: (logId: string, cardId: string) =>
        slicesRef.current.deleteTimeLog(logId, cardId),
      addAttachment: (cardId: string, file: File) => slicesRef.current.addAttachment(cardId, file),
      deleteAttachment: (attachment: Parameters<KanbanCtx["deleteAttachment"]>[0]) =>
        slicesRef.current.deleteAttachment(attachment),
    }),
    // Deps `[]` PROPOSITAIS: as ações leem tudo via stateRef/slicesRef, então
    // são estáveis para sempre. currentUserIdRef é um ref (estável). Não há
    // valor reativo capturado aqui — nada a listar, nada a esquecer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Rotinas: uma vez por login, depois que áreas e colunas carregaram, cria os
  // cards das rotinas do dia. A reserva no banco evita duplicar entre abas.
  const routinesRanForRef = useRef<string | null>(null);
  useEffect(() => {
    // tracks vazio = load ainda em voo (ex.: login sem reload não volta
    // loading para true). Sem áreas também não há o que gerar.
    if (loading || !user || tracks.length === 0) return;
    if (routinesRanForRef.current === user.id) return;
    routinesRanForRef.current = user.id;
    void generateDueRoutineCards({
      trackIds: new Set(stateRef.current.tracks.map((t) => t.id)),
      firstColumnFor: (trackId) => actions.getColumnsForTrack(trackId)[0]?.id,
      addCard: actions.addCard,
    });
    // Chaveado por user?.id (primitivo estável), como o load acima.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user?.id, actions, tracks.length]);

  // `value` agrega DADOS reativos + setters (estáveis) + ações (estáveis).
  // Recria quando algum dado muda — que é exatamente quando os consumidores
  // precisam ver a mudança. Todas as deps são valores reativos reais: o
  // footgun do array manual desapareceu (sem closure de ação capturada aqui).
  const value = useMemo<KanbanCtx>(
    () => ({
      cards,
      trilhas,
      tracks,
      columns,
      collapsed,
      search,
      setSearch,
      filter,
      setFilter,
      selectedAreaIds,
      setSelectedAreaIds,
      loading,
      loadError,
      createOpen,
      setCreateOpen,
      templates,
      cardColors,
      activitiesByCard,
      commentsByCard,
      timeLogsByCard,
      attachmentsByCard,
      ...actions,
    }),
    [
      cards,
      trilhas,
      tracks,
      columns,
      collapsed,
      search,
      filter,
      selectedAreaIds,
      createOpen,
      loading,
      loadError,
      templates,
      cardColors,
      activitiesByCard,
      commentsByCard,
      timeLogsByCard,
      attachmentsByCard,
      actions,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
