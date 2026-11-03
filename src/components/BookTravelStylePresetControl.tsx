import { Select } from 'antd';
import type { StylePreset } from '../stores/useStylePresetStore';
import { enabledStyleSegmentIdsForPreset } from '../utils/stylePresets';

interface BookTravelStylePresetControlProps {
  presets: StylePreset[];
  selectedPresetId: string | null;
  enabledStyleSegmentIds: string[] | null;
  onPresetChange: (presetId: string | null) => void;
  onEnabledStyleSegmentIdsChange: (ids: string[]) => void;
  title?: string;
  className?: string;
  selectAriaLabel?: string;
}

export function BookTravelStylePresetControl({
  presets,
  selectedPresetId,
  enabledStyleSegmentIds,
  onPresetChange,
  onEnabledStyleSegmentIdsChange,
  title = '文风预设',
  className,
  selectAriaLabel = '穿书文风预设',
}: BookTravelStylePresetControlProps) {
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? null;
  const visibleSegments = (selectedPreset?.segments ?? []).filter((segment) => segment.content.trim());
  const activeSegmentIds = enabledStyleSegmentIds ?? enabledStyleSegmentIdsForPreset(selectedPreset ?? undefined);

  const toggleSegment = (segmentId: string, checked: boolean) => {
    const next = new Set(activeSegmentIds);
    if (checked) next.add(segmentId);
    else next.delete(segmentId);
    onEnabledStyleSegmentIdsChange(visibleSegments.filter((segment) => next.has(segment.id)).map((segment) => segment.id));
  };

  return (
    <section className={className}>
      <h3>{title}</h3>
      {presets.length === 0 ? (
        <div className="book-travel-hud-empty">暂无文风预设，请先在背景页创建</div>
      ) : (
        <Select
          aria-label={selectAriaLabel}
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
  );
}
