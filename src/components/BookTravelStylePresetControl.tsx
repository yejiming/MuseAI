import { useState } from 'react';
import { CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { Select } from 'antd';
import type { StylePreset } from '../stores/useStylePresetStore';
import { enabledStyleSegmentIdsForPreset } from '../utils/stylePresets';
import { BookTravelCollapsibleSection } from './BookTravelCollapsibleSection';

interface BookTravelStylePresetControlProps {
  presets: StylePreset[];
  selectedPresetIds: string[];
  enabledStyleSegmentIds: string[] | null;
  onPresetsChange: (presetIds: string[], enabledStyleSegmentIds: string[] | null) => void;
  onEnabledStyleSegmentIdsChange: (ids: string[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panelId: string;
  title?: string;
  className?: string;
  selectAriaLabel?: string;
}

const visibleSegments = (preset: StylePreset | undefined) => (
  (preset?.segments ?? []).filter((segment) => segment.content.trim())
);

export function BookTravelStylePresetControl({
  presets,
  selectedPresetIds,
  enabledStyleSegmentIds,
  onPresetsChange,
  onEnabledStyleSegmentIdsChange,
  open,
  onOpenChange,
  panelId,
  title = '文风预设',
  className,
  selectAriaLabel = '穿书文风预设',
}: BookTravelStylePresetControlProps) {
  const [isAdding, setIsAdding] = useState(false);
  const presetById = new Map(presets.map((preset) => [preset.id, preset]));
  const selectedPresets = selectedPresetIds.flatMap((id) => {
    const preset = presetById.get(id);
    return preset ? [preset] : [];
  });
  const unusedPresets = presets.filter((preset) => !selectedPresetIds.includes(preset.id));
  const rows = selectedPresetIds.length > 0 ? selectedPresetIds : [null];

  const commitIds = (nextIds: string[]) => {
    const seen = new Set<string>();
    const unique = nextIds.filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (enabledStyleSegmentIds == null) {
      onPresetsChange(unique, null);
      return;
    }
    const removed = new Set(selectedPresetIds.filter((id) => !unique.includes(id)));
    const added = unique.filter((id) => !selectedPresetIds.includes(id));
    const removedSegmentIds = new Set(
      presets.filter((preset) => removed.has(preset.id)).flatMap((preset) => preset.segments.map((segment) => segment.id)),
    );
    const kept = enabledStyleSegmentIds.filter((id) => !removedSegmentIds.has(id));
    const extras = added.flatMap((id) => enabledStyleSegmentIdsForPreset(presetById.get(id)));
    const nextEnabled = [...kept];
    extras.forEach((id) => {
      if (!nextEnabled.includes(id)) nextEnabled.push(id);
    });
    onPresetsChange(unique, nextEnabled);
  };

  const toggleSegment = (segmentId: string, checked: boolean) => {
    const current = new Set(
      enabledStyleSegmentIds ?? selectedPresets.flatMap((preset) => enabledStyleSegmentIdsForPreset(preset)),
    );
    if (checked) current.add(segmentId);
    else current.delete(segmentId);
    const order = selectedPresets.flatMap((preset) => visibleSegments(preset).map((segment) => segment.id));
    onEnabledStyleSegmentIdsChange(order.filter((id) => current.has(id)));
  };

  return (
    <BookTravelCollapsibleSection
      title={title}
      className={className}
      open={open}
      onOpenChange={onOpenChange}
      panelId={panelId}
    >
      {presets.length === 0 ? (
        <div className="book-travel-hud-empty">暂无文风预设，请先在背景页创建</div>
      ) : (
        <>
          <div className="book-travel-style-preset-list">
            {rows.map((presetId, index) => {
              const preset = presetId ? presetById.get(presetId) : undefined;
              const options = presets.filter((item) => item.id === presetId || !selectedPresetIds.includes(item.id));
              const activeSegmentIds = enabledStyleSegmentIds == null
                ? enabledStyleSegmentIdsForPreset(preset)
                : visibleSegments(preset).filter((segment) => enabledStyleSegmentIds.includes(segment.id)).map((segment) => segment.id);
              return (
                <div key={presetId ?? 'empty'} className="book-travel-style-preset-item">
                  <div className="book-travel-style-preset-row">
                    <Select
                      aria-label={index === 0 ? selectAriaLabel : `${selectAriaLabel} ${index + 1}`}
                      value={preset?.id}
                      options={options.map((item) => ({ label: item.name, value: item.id }))}
                      placeholder="选择文风预设"
                      allowClear
                      style={{ width: '100%' }}
                      onChange={(nextId) => {
                        if (selectedPresetIds.length === 0) {
                          commitIds(nextId ? [nextId] : []);
                          return;
                        }
                        const next = [...selectedPresetIds];
                        if (!nextId) next.splice(index, 1);
                        else next[index] = nextId;
                        commitIds(next);
                      }}
                    />
                    {presetId ? (
                      <button
                        type="button"
                        className="book-travel-style-preset-remove"
                        aria-label={`移除文风预设 ${preset?.name || '未命名预设'}`}
                        onClick={() => commitIds(selectedPresetIds.filter((_, rowIndex) => rowIndex !== index))}
                      >
                        <CloseOutlined aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  {visibleSegments(preset).length > 0 ? (
                    <div className="book-travel-hud-checks">
                      {visibleSegments(preset).map((segment) => (
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
                </div>
              );
            })}
          </div>
          {isAdding && unusedPresets.length > 0 ? (
            <div className="book-travel-style-preset-row book-travel-style-preset-add-row">
              <Select
                aria-label="选择要添加的文风预设"
                options={unusedPresets.map((preset) => ({ label: preset.name, value: preset.id }))}
                placeholder="选择文风预设"
                style={{ width: '100%' }}
                onChange={(presetId) => {
                  if (!presetId) return;
                  commitIds([...selectedPresetIds, presetId]);
                  setIsAdding(false);
                }}
              />
              <button
                type="button"
                className="book-travel-style-preset-remove"
                aria-label="取消添加文风预设"
                onClick={() => setIsAdding(false)}
              >
                <CloseOutlined aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {!isAdding && selectedPresetIds.length > 0 && unusedPresets.length > 0 ? (
            <button
              type="button"
              className="book-travel-style-preset-add"
              onClick={() => setIsAdding(true)}
            >
              <PlusOutlined aria-hidden="true" />
              <span>添加文风预设</span>
            </button>
          ) : null}
        </>
      )}
    </BookTravelCollapsibleSection>
  );
}
