import { StylePreset, StylePresetSegment } from '../stores/useStylePresetStore';

export interface ResolvedStylePresets {
  presets: StylePreset[];
  segments: Array<{ preset: StylePreset; segment: StylePresetSegment }>;
  missingIds: string[];
  totalCharacters: number;
}

export const enabledStyleSegmentIdsForPreset = (preset: StylePreset | undefined): string[] => (
  (preset?.segments ?? [])
    .filter((segment) => segment.enabled && segment.content.trim())
    .map((segment) => segment.id)
);

export const resolveStylePresets = (
  presets: StylePreset[],
  selectedIds: string[],
  enabledSegmentIds?: string[] | null,
): ResolvedStylePresets => {
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  const missingIds: string[] = [];
  const resolved = selectedIds.flatMap((id) => {
    const preset = byId.get(id);
    if (!preset) {
      missingIds.push(id);
      return [];
    }
    return [preset];
  });
  const allowedSegmentIds = enabledSegmentIds == null ? null : new Set(enabledSegmentIds);
  const segments = resolved.flatMap((preset) => preset.segments.flatMap((segment) => {
    if (!segment.content.trim()) return [];
    const included = allowedSegmentIds
      ? allowedSegmentIds.has(segment.id)
      : segment.enabled;
    return included ? [{ preset, segment }] : [];
  }));
  return {
    presets: resolved,
    segments,
    missingIds,
    totalCharacters: segments.reduce((sum, item) => sum + item.segment.content.length, 0),
  };
};

export const prependStylePresets = (
  baseSystemPrompt: string,
  presets: StylePreset[],
  selectedIds: string[],
  enabledSegmentIds?: string[] | null,
) => {
  const resolved = resolveStylePresets(presets, selectedIds, enabledSegmentIds).segments;
  if (resolved.length === 0) return baseSystemPrompt;
  const presetBlock = resolved
    .map(({ segment }) => segment.content.trim())
    .join('\n\n');
  return baseSystemPrompt.trim() ? `${presetBlock}\n\n${baseSystemPrompt}` : presetBlock;
};
