import type { AgentSessionSummary } from '../stores/useAgentStore';
import type { PartnerItem } from '../stores/usePartnerStore';
import type { BookTravelAssembledMaterial, BookTravelSavedProgress } from '../stores/useBookTravelStore';

export interface ResolvedSessionHistoryMeta {
  worldBookId: string | null;
  worldBookName: string | null;
  characterCards: Array<{ id: string; name: string }>;
}

function getSessionCharacterCardIds(session: AgentSessionSummary): string[] {
  if (Array.isArray(session.characterCardIds) && session.characterCardIds.length > 0) {
    return session.characterCardIds.filter(Boolean);
  }
  return session.characterCardId ? [session.characterCardId] : [];
}

export function resolveSessionHistoryMeta(
  session: AgentSessionSummary,
  worldBooks: PartnerItem[],
  characterCards: PartnerItem[],
): ResolvedSessionHistoryMeta {
  const cardIds = getSessionCharacterCardIds(session);
  const resolvedCards = cardIds
    .map((id) => characterCards.find((card) => card.id === id))
    .filter((card): card is PartnerItem => Boolean(card))
    .map((card) => ({ id: card.id, name: card.name }));

  const fallbackWorldBookId = cardIds
    .map((id) => characterCards.find((card) => card.id === id)?.worldBookId ?? null)
    .find((id): id is string => Boolean(id));
  const worldBookId = session.selectedWorldBookId || fallbackWorldBookId || null;
  const worldBookName = worldBookId
    ? worldBooks.find((worldBook) => worldBook.id === worldBookId)?.name ?? null
    : null;

  return {
    worldBookId,
    worldBookName,
    characterCards: resolvedCards,
  };
}

export function sessionMatchesHistoryFilters(
  session: AgentSessionSummary,
  worldBooks: PartnerItem[],
  characterCards: PartnerItem[],
  filters: { worldBookId?: string | null; characterCardId?: string | null },
) {
  const meta = resolveSessionHistoryMeta(session, worldBooks, characterCards);
  if (filters.worldBookId && meta.worldBookId !== filters.worldBookId) return false;
  if (filters.characterCardId && !meta.characterCards.some((card) => card.id === filters.characterCardId)) return false;
  return true;
}

export function resolveBookTravelProgressMaterial(
  progress: BookTravelSavedProgress,
  materials: BookTravelAssembledMaterial[],
): BookTravelAssembledMaterial | null {
  if (progress.materialId) {
    const explicit = materials.find((material) => material.id === progress.materialId);
    if (explicit) return explicit;
  }

  const sessionKeyMatch = materials.find((material) => progress.sessionKey.startsWith(`${material.id}-`));
  if (sessionKeyMatch) return sessionKeyMatch;

  const snapshot = progress.snapshot;
  return materials.find((material) => {
    if (snapshot.selectedOutline?.id !== material.materials.outline.id) return false;
    if (snapshot.selectedWorldBook?.id !== material.materials.worldBook.id) return false;
    const snapshotCardIds = snapshot.selectedCharacterCards.map((card) => card.id).sort();
    const materialCardIds = material.materials.characterCards.map((card) => card.id).sort();
    return snapshotCardIds.length === materialCardIds.length
      && snapshotCardIds.every((id, index) => id === materialCardIds[index]);
  }) ?? null;
}
