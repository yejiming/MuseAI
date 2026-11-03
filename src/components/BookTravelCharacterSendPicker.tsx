import type { BookTravelMaterial } from '../stores/useBookTravelStore';

interface BookTravelCharacterSendPickerProps {
  characterCards: BookTravelMaterial[];
  enabledCharacterCardIds: string[] | null;
  onEnabledCharacterCardIdsChange: (ids: string[]) => void;
  title?: string;
  className?: string;
  labelForCard?: (card: BookTravelMaterial) => string;
}

const checkedCharacterIds = (cards: BookTravelMaterial[], enabledIds: string[] | null) => (
  enabledIds ?? cards.map((card) => card.id)
);

export function BookTravelCharacterSendPicker({
  characterCards,
  enabledCharacterCardIds,
  onEnabledCharacterCardIdsChange,
  title = '本轮发送的人物',
  className,
  labelForCard = (card) => `本轮发送 ${card.title}`,
}: BookTravelCharacterSendPickerProps) {
  const activeCharacterIds = checkedCharacterIds(characterCards, enabledCharacterCardIds);

  const toggleCharacter = (cardId: string, checked: boolean) => {
    const next = new Set(activeCharacterIds);
    if (checked) next.add(cardId);
    else next.delete(cardId);
    onEnabledCharacterCardIdsChange(characterCards.filter((card) => next.has(card.id)).map((card) => card.id));
  };

  return (
    <section className={className}>
      <h3>{title}</h3>
      {characterCards.length === 0 ? (
        <div className="book-travel-hud-empty">这份素材没有人物卡</div>
      ) : (
        <div className="book-travel-hud-checks">
          {characterCards.map((card) => (
            <label key={card.id} className="book-travel-hud-check">
              <input
                type="checkbox"
                aria-label={labelForCard(card)}
                checked={activeCharacterIds.includes(card.id)}
                onChange={(event) => toggleCharacter(card.id, event.target.checked)}
              />
              <span>{card.title}</span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
