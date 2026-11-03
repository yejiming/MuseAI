import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeStylePresets, useStylePresetStore } from '../stores/useStylePresetStore';
import { prependStylePresets, resolveStylePresets } from '../utils/stylePresets';

describe('文风预设', () => {
  beforeEach(() => useStylePresetStore.setState({ presets: [], selectedPresetId: null }));

  it('直接创建带空白片段的未命名预设', () => {
    const id = useStylePresetStore.getState().addPreset();
    const preset = useStylePresetStore.getState().presets[0];
    expect(preset).toMatchObject({ id, name: '未命名预设' });
    expect(preset.segments).toHaveLength(1);
    expect(preset.segments[0]).toMatchObject({ title: '未命名提示词', content: '', enabled: true });
    expect(useStylePresetStore.getState().selectedPresetId).toBe(id);
  });

  it('迁移旧版单正文预设为一个开启的提示词片段', () => {
    const [preset] = normalizeStylePresets([{ id: 'legacy', name: '旧预设', target: 'chat', content: '旧正文', createdAt: 1, updatedAt: 1 }]);
    expect(preset.segments).toEqual([expect.objectContaining({ title: '提示词 1', content: '旧正文', enabled: true })]);
  });

  it('按预设选择顺序和片段顺序拼接，并忽略关闭或空白片段', () => {
    const presets = normalizeStylePresets([
      { id: 'a', name: '预设甲', segments: [
        { id: 'a1', title: '甲一', content: '第一段', enabled: true },
        { id: 'a2', title: '甲二', content: '不应出现', enabled: false },
      ], createdAt: 1, updatedAt: 1 },
      { id: 'b', name: '预设乙', segments: [
        { id: 'b1', title: '乙一', content: '第二段', enabled: true },
      ], createdAt: 1, updatedAt: 1 },
    ]);
    const result = prependStylePresets('基础提示词', presets, ['b', 'missing', 'a']);
    expect(result.indexOf('第二段')).toBeLessThan(result.indexOf('第一段'));
    expect(result.indexOf('第一段')).toBeLessThan(result.indexOf('基础提示词'));
    expect(result).not.toContain('不应出现');
    expect(result).not.toContain('预设甲');
    expect(result).not.toContain('甲一');
    expect(result).not.toContain('##');
    expect(resolveStylePresets(presets, ['missing', 'a']).missingIds).toEqual(['missing']);
  });

  it('本局片段名单可以带上预设里关闭的片段，并排除未勾选片段', () => {
    const presets = normalizeStylePresets([
      { id: 'a', name: '预设甲', segments: [
        { id: 'a1', title: '甲一', content: '第一段', enabled: false },
        { id: 'a2', title: '甲二', content: '第二段', enabled: true },
      ], createdAt: 1, updatedAt: 1 },
    ]);

    const result = prependStylePresets('基础提示词', presets, ['a'], ['a1']);

    expect(result).toContain('第一段');
    expect(result).not.toContain('第二段');
  });

  it('保留重复选择、对象引用、片段顺序和字符统计', () => {
    const presets = normalizeStylePresets([
      { id: 'a', name: '预设甲', segments: [
        { id: 'a1', title: '甲一', content: '甲', enabled: true },
        { id: 'a2', title: '空白', content: '   ', enabled: true },
        { id: 'a3', title: '关闭', content: '不应计入', enabled: false },
        { id: 'a4', title: '甲二', content: '乙乙', enabled: true },
      ], createdAt: 1, updatedAt: 1 },
    ]);

    const result = resolveStylePresets(presets, ['missing', 'a', 'a']);

    expect(result.missingIds).toEqual(['missing']);
    expect(result.presets).toEqual([presets[0], presets[0]]);
    expect(result.segments.map(({ segment }) => segment.id)).toEqual(['a1', 'a4', 'a1', 'a4']);
    expect(result.segments[0].preset).toBe(presets[0]);
    expect(result.segments[0].segment).toBe(presets[0].segments[0]);
    expect(result.totalCharacters).toBe(6);
  });

  it('支持片段启停、更新和重排', () => {
    const presetId = useStylePresetStore.getState().addPreset();
    const firstId = useStylePresetStore.getState().presets[0].segments[0].id;
    const secondId = useStylePresetStore.getState().addSegment(presetId);
    useStylePresetStore.getState().updateSegment(presetId, firstId, { title: '第一段', content: '一', enabled: false });
    useStylePresetStore.getState().updateSegment(presetId, secondId, { title: '第二段', content: '二' });
    useStylePresetStore.getState().reorderSegments(presetId, 1, 0);
    expect(useStylePresetStore.getState().presets[0].segments.map((segment) => segment.title)).toEqual(['第二段', '第一段']);
    expect(useStylePresetStore.getState().presets[0].segments[1].enabled).toBe(false);
  });
});
