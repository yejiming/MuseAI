import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshAssembledCharacterCards, resolveOutlineMaterial, resolvePartnerMaterials, filterBookTravelRequestContext } from '../utils/bookTravelMaterials';
import { usePartnerStore } from '../stores/usePartnerStore';

vi.mock('../utils/runtime', () => ({
  appInvoke: vi.fn(async (command: string, args?: { path?: string }) => {
    if (command === 'read_file' && args?.path === '/outline/第一卷.md') {
      return '# 第一卷\n\n主角醒来。';
    }
    if (command === 'save_app_state') {
      return undefined;
    }
    if (command === 'load_app_state') {
      return '';
    }
    throw new Error(`unexpected command ${command}`);
  }),
}));

describe('book-travel material resolution', () => {
  beforeEach(() => {
    usePartnerStore.setState({
      worldBooks: [
        { id: 'wb-1', name: '云州世界书', type: 'world_book', content: '世界书正文' },
      ],
      characterCards: [
        { id: 'cc-1', name: '沈霜', type: 'character_card', content: '沈霜正文' },
        { id: 'cc-2', name: '陆衡', type: 'character_card', content: '陆衡正文' },
      ],
    });
  });

  it('resolves selected outline content through the safe file-read path', async () => {
    const outline = await resolveOutlineMaterial('/outline/第一卷.md');

    expect(outline).toEqual({
      id: '/outline/第一卷.md',
      title: '第一卷.md',
      path: '/outline/第一卷.md',
      content: '# 第一卷\n\n主角醒来。',
    });
  });

  it('resolves world book and character cards from partner store without mutation', () => {
    const before = usePartnerStore.getState();

    const result = resolvePartnerMaterials('wb-1', ['cc-1', 'cc-2']);

    expect(result.worldBook).toEqual({ id: 'wb-1', title: '云州世界书', content: '世界书正文' });
    expect(result.characterCards).toEqual([
      { id: 'cc-1', title: '沈霜', content: '沈霜正文' },
      { id: 'cc-2', title: '陆衡', content: '陆衡正文' },
    ]);
    expect(usePartnerStore.getState().worldBooks).toBe(before.worldBooks);
    expect(usePartnerStore.getState().characterCards).toBe(before.characterCards);
  });

  it('resolves character cards by stripping character memory fields', () => {
    usePartnerStore.setState({
      worldBooks: [],
      characterCards: [
        {
          id: 'cc-3',
          name: '赫敏',
          type: 'character_card',
          content: '赫敏原正文',
          fields: {
            age: '12',
            userRelationType: '好友',
            userInteractionModel: '互助',
            userRelationBottomLine: '原则问题',
            relationMemory: '图书馆学习',
            keyEvents: '遭遇巨怪',
            skills: '魔法咒语',
          },
        },
      ],
    });

    const result = resolvePartnerMaterials('wb-none', ['cc-3']);
    const ccContent = result.characterCards[0].content;

    // The recompiled markdown content must contain basic info and skills but NOT relationship/memory fields
    expect(ccContent).toContain('12');
    expect(ccContent).toContain('魔法咒语');
    expect(ccContent).not.toContain('好友');
    expect(ccContent).not.toContain('互助');
    expect(ccContent).not.toContain('原则问题');
    expect(ccContent).not.toContain('图书馆学习');
    expect(ccContent).not.toContain('遭遇巨怪');
    expect(ccContent).not.toContain('角色记忆');
    expect(ccContent).not.toContain('与用户关系类型');
    expect(ccContent).not.toContain('与用户相处模式');
    expect(ccContent).not.toContain('与用户关系底线');
    expect(ccContent).not.toContain('关键事件');
  });

  it('refreshes a selected character by world book and name, including a regenerated card id', () => {
    usePartnerStore.setState({
      worldBooks: [{ id: 'wb-1', name: '云州世界书', type: 'world_book', content: '世界书正文' }],
      characterCards: [
        {
          id: 'cc-new',
          name: '沈霜',
          type: 'character_card',
          content: '旧正文',
          fields: { skills: '新剑法', userRelationType: '好友' },
          worldBookId: 'wb-1',
        },
        {
          id: 'cc-other-book',
          name: '沈霜',
          type: 'character_card',
          content: '其他世界书',
          fields: { skills: '不该写入' },
          worldBookId: 'wb-2',
        },
      ],
    });

    const refreshed = refreshAssembledCharacterCards(
      [
        { id: 'cc-1', title: '沈霜', content: '旧设定' },
        { id: 'cc-2', title: '陆衡', content: '陆衡旧设定' },
      ],
      'wb-1',
      ['cc-1', 'missing'],
      { originalTimeline: ['旧线'], selectedCharacterProfiles: ['沈霜：旧摘要', '陆衡：不动'] },
    );

    expect(refreshed.worldBookMissing).toBe(false);
    expect(refreshed.characterCards[0]).toMatchObject({ id: 'cc-new', title: '沈霜' });
    expect(refreshed.characterCards[0].content).toContain('新剑法');
    expect(refreshed.characterCards[0].content).not.toContain('好友');
    expect(refreshed.characterCards[0].content).not.toContain('不该写入');
    expect(refreshed.characterCards[1].content).toBe('陆衡旧设定');
    expect(refreshed.missingIds).toEqual(['missing']);
    expect(refreshed.assembledWorldModel).toMatchObject({
      originalTimeline: ['旧线'],
      selectedCharacterProfiles: ['沈霜：姓名：沈霜 新剑法', '陆衡：不动'],
    });
  });

  it('does not refresh characters when the bound world book is gone', () => {
    usePartnerStore.setState({
      worldBooks: [],
      characterCards: [
        { id: 'cc-new', name: '沈霜', type: 'character_card', content: '新正文', worldBookId: 'wb-1' },
      ],
    });

    const refreshed = refreshAssembledCharacterCards(
      [{ id: 'cc-1', title: '沈霜', content: '旧设定' }],
      'wb-1',
      ['cc-1'],
      { selectedCharacterProfiles: ['沈霜：旧摘要'] },
    );

    expect(refreshed.worldBookMissing).toBe(true);
    expect(refreshed.refreshedCards).toEqual([]);
    expect(refreshed.characterCards[0].content).toBe('旧设定');
  });

  it('drops unchecked character cards and their profile lines from the request context', () => {
    const filtered = filterBookTravelRequestContext(
      [
        { id: 'cc-1', title: '沈霜', content: '沈霜完整设定' },
        { id: 'cc-2', title: '陆衡', content: '陆衡完整设定' },
      ],
      ['cc-1'],
      { selectedCharacterProfiles: ['沈霜：冷', '陆衡：稳', '旁白：无人认领'] },
    );

    expect(filtered.characterCards).toEqual([{ id: 'cc-1', title: '沈霜', content: '沈霜完整设定' }]);
    expect(filtered.assembledWorldModel).toMatchObject({
      selectedCharacterProfiles: ['沈霜：冷'],
    });
  });
});
