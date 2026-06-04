import { describe, expect, it } from 'vitest';
import { usePartnerStore } from '../stores/usePartnerStore';
import { applyPartnerStoreContent } from '../utils/partnerStoreSync';

describe('partner store sync', () => {
  it('applies persisted partner state into the desktop store', () => {
    const applied = applyPartnerStoreContent(JSON.stringify({
      state: {
        worldBooks: [],
        characterCards: [
          {
            id: 'card-1',
            name: '禾禾',
            type: 'character_card',
            content: '# 角色卡：禾禾',
            fields: {
              userRelationType: '伙伴',
              keyEvents: '共同完成一次对话',
            },
          },
        ],
        selectedId: null,
        selectedType: null,
      },
      version: 0,
    }));

    expect(applied).toBe(true);
    expect(usePartnerStore.getState().characterCards[0].fields?.userRelationType).toBe('伙伴');
    expect(usePartnerStore.getState().characterCards[0].fields?.keyEvents).toBe('共同完成一次对话');
  });
});
