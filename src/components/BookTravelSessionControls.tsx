import type { BookTravelMaterial } from '../stores/useBookTravelStore';
import type { StylePreset } from '../stores/useStylePresetStore';
import { BookTravelCharacterSendPicker } from './BookTravelCharacterSendPicker';
import { BookTravelStylePresetControl } from './BookTravelStylePresetControl';

interface BookTravelSessionControlsProps {
  characterCards: BookTravelMaterial[];
  enabledCharacterCardIds: string[] | null;
  onEnabledCharacterCardIdsChange: (ids: string[]) => void;
  characterPanelOpen: boolean;
  onCharacterPanelOpenChange: (open: boolean) => void;
  presets: StylePreset[];
  selectedPresetIds: string[];
  enabledStyleSegmentIds: string[] | null;
  onPresetsChange: (presetIds: string[], enabledStyleSegmentIds: string[] | null) => void;
  onEnabledStyleSegmentIdsChange: (ids: string[]) => void;
  stylePresetPanelOpen: boolean;
  onStylePresetPanelOpenChange: (open: boolean) => void;
}

export function BookTravelSessionControls({
  characterCards,
  enabledCharacterCardIds,
  onEnabledCharacterCardIdsChange,
  characterPanelOpen,
  onCharacterPanelOpenChange,
  presets,
  selectedPresetIds,
  enabledStyleSegmentIds,
  onPresetsChange,
  onEnabledStyleSegmentIdsChange,
  stylePresetPanelOpen,
  onStylePresetPanelOpenChange,
}: BookTravelSessionControlsProps) {
  return (
    <div className="book-travel-session-controls">
      <BookTravelCharacterSendPicker
        className="book-travel-hud-section"
        panelId="book-travel-session-characters"
        characterCards={characterCards}
        enabledCharacterCardIds={enabledCharacterCardIds}
        onEnabledCharacterCardIdsChange={onEnabledCharacterCardIdsChange}
        open={characterPanelOpen}
        onOpenChange={onCharacterPanelOpenChange}
      />
      <BookTravelStylePresetControl
        className="book-travel-hud-section"
        panelId="book-travel-session-style"
        selectAriaLabel="穿书状态文风预设"
        presets={presets}
        selectedPresetIds={selectedPresetIds}
        enabledStyleSegmentIds={enabledStyleSegmentIds}
        onPresetsChange={onPresetsChange}
        onEnabledStyleSegmentIdsChange={onEnabledStyleSegmentIdsChange}
        open={stylePresetPanelOpen}
        onOpenChange={onStylePresetPanelOpenChange}
      />
    </div>
  );
}
