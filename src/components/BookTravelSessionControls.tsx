import type { BookTravelMaterial } from '../stores/useBookTravelStore';
import type { StylePreset } from '../stores/useStylePresetStore';
import { BookTravelCharacterSendPicker } from './BookTravelCharacterSendPicker';
import { BookTravelStylePresetControl } from './BookTravelStylePresetControl';

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
  return (
    <div className="book-travel-session-controls">
      <BookTravelCharacterSendPicker
        className="book-travel-hud-section"
        characterCards={characterCards}
        enabledCharacterCardIds={enabledCharacterCardIds}
        onEnabledCharacterCardIdsChange={onEnabledCharacterCardIdsChange}
      />
      <BookTravelStylePresetControl
        className="book-travel-hud-section"
        selectAriaLabel="穿书状态文风预设"
        presets={presets}
        selectedPresetId={selectedPresetId}
        enabledStyleSegmentIds={enabledStyleSegmentIds}
        onPresetChange={onPresetChange}
        onEnabledStyleSegmentIdsChange={onEnabledStyleSegmentIdsChange}
      />
    </div>
  );
}
