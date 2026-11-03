import { Select } from 'antd';
import type { BookTravelMaterial } from '../stores/useBookTravelStore';
import type { StylePreset } from '../stores/useStylePresetStore';
import { enabledStyleSegmentIdsForPreset } from '../utils/stylePresets';

interface BookTravelSessionControlsProps {
  characterCards: BookTravelMaterial[];
  enabledCharacterCardIds: string[] | null;
  onEnabledCharacterCardIdsChange: (ids: string[]) => void;
  presets: StylePreset[];
  selectedPresetId: string | null;
  enabledStyleSegmentIds: string[] | null;
  onPresetChange: (presetId: string | null) => void;
  onEnabledStyleSegmentIdsChange: (ids: string[]) => void;
}

const checkedCharacterIds = (cards: BookTravelMaterial[], enabledIds: string[] | null) => (
  enabledIds ?? cards.map((card) => card.id)
);

export function BookTravelSessionControls({
  characterCards,
  enabledCharacterCardIds,
  onEnabledCharacterCardIdsChange,
  presets,
  selectedPresetId,
  enabledStyleSegmentIds,
  onPresetChange,
  onEnabledStyleSegmentIdsChange,
}: BookTravelSessionControlsProps) {
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? null;
  const visibleSegments = (selectedPreset?.segments ?? []).filter((segment) => segment.content.trim());
  const activeCharacterIds = checkedCharacterIds(characterCards, enabledCharacterCardIds);
  const activeSegmentIds = enabledStyleSegmentIds ?? enabledStyleSegmentIdsForPreset(selectedPreset ?? undefined);

  const toggleCharacter = (cardId: string, checked: boolean) => {
    const next = new Set(activeCharacterIds);
    if (checked) next.add(cardId);
    else next.delete(cardId);
    onEnabledCharacterCardIdsChange(characterCards.filter((card) => next.has(card.id)).map((card) => card.id));
  };

  const toggleSegment = (segmentId: string, checked: boolean) => {
    const next = new Set(activeSegmentIds);
    if (checked) next.add(segmentId);
    else next.delete(segmentId);
    onEnabledStyleSegmentIdsChange(visibleSegments.filter((segment) => next.has(segment.id)).map((segment) => segment.id));
  };

  return (
    <div className="book-travel-session-controls">
      <section className="book-travel-hud-section">
        <h3>本轮发送的人物</h3>
        {characterCards.length === 0 ? (
          <div className="book-travel-hud-empty">这份素材没有人物卡</div>
        ) : (
          <div className="book-travel-hud-checks">
            {characterCards.map((card) => (
              <label key={card.id} className="book-travel-hud-check">
                <input
                  type="checkbox"
                  aria-label={`本轮发送 ${card.title}`}
                  checked={activeCharacterIds.includes(card.id)}
                  onChange={(event) => toggleCharacter(card.id, event.target.checked)}
                />
                <span>{card.title}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="book-travel-hud-section">
        <h3>文风预设</h3>
        {presets.length === 0 ? (
          <div className="book-travel-hud-empty">暂无文风预设，请先在背景页创建</div>
        ) : (
          <Select
            aria-label="穿书状态文风预设"
            value={selectedPreset ? selectedPreset.id : undefined}
            options={presets.map((preset) => ({ label: preset.name, value: preset.id }))}
            placeholder="选择文风预设"
            allowClear
            style={{ width: '100%' }}
            onChange={(presetId) => onPresetChange(presetId || null)}
          />
        )}
        {visibleSegments.length > 0 ? (
          <div className="book-travel-hud-checks">
            {visibleSegments.map((segment) => (
              <label key={segment.id} className="book-travel-hud-check">
                <input
                  type="checkbox"
                  aria-label={`本局提示词 ${segment.title || '未命名提示词'}`}
                  checked={activeSegmentIds.includes(segment.id)}
                  onChange={(event) => toggleSegment(segment.id, event.target.checked)}
                />
                <span>{segment.title || '未命名提示词'}</span>
              </label>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
