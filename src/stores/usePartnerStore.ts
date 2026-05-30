import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PartnerItemFields {
  // 世界书字段
  theme?: string;         // 主题
  era?: string;           // 时代
  techLevel?: string;     // 科技水平
  magicLevel?: string;    // 魔法水平
  geography?: string;     // 地理格局
  keyScenes?: string;     // 关键场景
  culturalFeatures?: string; // 文化特色
  history?: string;       // 历史事件
  conflict?: string;      // 核心矛盾

  // 角色卡字段
  // 基础信息
  age?: string;           // 年龄
  gender?: string;        // 性别
  race?: string;          // 种族
  birthplace?: string;    // 出生地
  occupation?: string;    // 职业
  socialClass?: string;   // 社会阶层
  
  // 身份标签
  identityTags?: string[]; // 身份标签
  
  // 外貌气质
  heightBuild?: string;     // 身高体型
  iconicFeatures?: string;  // 标志性特征
  clothingStyle?: string;   // 衣着风格
  overallVibe?: string;     // 整体气质

  // 性格
  externalPersonality?: string; // 外在性格
  internalPersonality?: string; // 内在性格
  coreDesire?: string;          // 核心欲望
  fearWeakness?: string;        // 恐惧和弱点
  moralValues?: string;         // 道德观念
  quirk?: string;               // 怪癖

  // 技能专长
  skills?: string;
  
  // 背景故事
  backgroundStory?: string;
  
  // 人际关系
  relationships?: string;
  
  // 说话方式
  speakingStyle?: string;
  
  // 典型反应
  typicalReactions?: string;
}

export interface PartnerItem {
  id: string;
  name: string;
  type: 'world_book' | 'character_card';
  content: string;
  fields?: PartnerItemFields;
}

interface PartnerState {
  worldBooks: PartnerItem[];
  characterCards: PartnerItem[];
  selectedId: string | null;
  selectedType: 'world_book' | 'character_card' | null;
  addWorldBook: () => void;
  addCharacterCard: () => void;
  selectItem: (id: string | null, type: 'world_book' | 'character_card' | null) => void;
  deleteItem: (id: string, type: 'world_book' | 'character_card') => void;
  updateItemName: (id: string, type: 'world_book' | 'character_card', name: string) => void;
  updateItemContent: (id: string, type: 'world_book' | 'character_card', content: string) => void;
  updateItemFields: (id: string, type: 'world_book' | 'character_card', fields: PartnerItemFields) => void;
}

export const compileItemToMarkdown = (name: string, type: 'world_book' | 'character_card', fields: PartnerItemFields): string => {
  if (type === 'world_book') {
    return `# ${name}\n\n` +
      `## 核心设定\n` +
      `- **主题**：${fields.theme || ''}\n` +
      `- **时代**：${fields.era || ''}\n` +
      `- **科技水平**：${fields.techLevel || ''}\n` +
      `- **魔法水平**：${fields.magicLevel || ''}\n\n` +
      `## 地理格局\n${fields.geography || ''}\n\n` +
      `## 关键场景\n${fields.keyScenes || ''}\n\n` +
      `## 文化特色\n${fields.culturalFeatures || ''}\n\n` +
      `## 历史事件\n${fields.history || ''}\n\n` +
      `## 核心矛盾\n${fields.conflict || ''}`;
  } else {
    const tagsStr = (fields.identityTags || []).map(t => `\`${t}\``).join(' ');
    return `# 角色卡：${name}\n\n` +
      `## 基础信息\n` +
      `- **姓名**：${name}\n` +
      `- **年龄**：${fields.age || ''}\n` +
      `- **性别**：${fields.gender || ''}\n` +
      `- **种族**：${fields.race || ''}\n` +
      `- **出生地**：${fields.birthplace || ''}\n` +
      `- **职业**：${fields.occupation || ''}\n` +
      `- **社会阶层**：${fields.socialClass || ''}\n\n` +
      `## 身份标签\n${tagsStr || '无'}\n\n` +
      `## 外貌气质\n` +
      `- **身高体型**：${fields.heightBuild || ''}\n` +
      `- **标志性特征**：${fields.iconicFeatures || ''}\n` +
      `- **衣着风格**：${fields.clothingStyle || ''}\n` +
      `- **整体气质**：${fields.overallVibe || ''}\n\n` +
      `## 性格特征\n` +
      `- **外在性格**：${fields.externalPersonality || ''}\n` +
      `- **内在性格**：${fields.internalPersonality || ''}\n` +
      `- **核心欲望**：${fields.coreDesire || ''}\n` +
      `- **恐惧和弱点**：${fields.fearWeakness || ''}\n` +
      `- **道德观念**：${fields.moralValues || ''}\n` +
      `- **怪癖**：${fields.quirk || ''}\n\n` +
      `## 技能专长\n${fields.skills || ''}\n\n` +
      `## 背景故事\n${fields.backgroundStory || ''}\n\n` +
      `## 人际关系\n${fields.relationships || ''}\n\n` +
      `## 说话方式\n${fields.speakingStyle || ''}\n\n` +
      `## 典型反应\n${fields.typicalReactions || ''}`;
  }
};

const initialWorldBooks: PartnerItem[] = [
  {
    id: 'wb-initial-1',
    name: '魔法大陆设定集',
    type: 'world_book',
    content: '', // Will be compiled on load or defined below
    fields: {
      theme: '魔法冒险 / 奇幻史诗',
      era: '魔法工业革命时期',
      techLevel: '蒸汽机与简单电气技术',
      magicLevel: '高魔世界，以太广泛应用',
      geography: '奥兰王国坐落于富庶的东部平原，雷德帝国占据崎岖的多山北部，两大势力隔着横亘大陆的“静止山脉”对峙。',
      keyScenes: '奥兰魔法学院大图书馆、雷德帝国以太重工熔炉厂、静止山脉大峡谷前哨站',
      culturalFeatures: '以太崇拜，视魔法为自然的神圣赐予；北部雷德帝国崇尚机械与效率，视魔法为一种可量化利用的二次能源。',
      history: '三十年前的“以太风暴之战”，两大国死伤无数，最终在静止山脉签署停战协议。',
      conflict: '以太资源的日渐枯竭与雷德帝国日益膨胀的领土野心，同奥兰王国保守主义的旧魔法贵族阶层之间的不可调和的矛盾。'
    }
  }
];
initialWorldBooks[0].content = compileItemToMarkdown(initialWorldBooks[0].name, 'world_book', initialWorldBooks[0].fields!);

const initialCharacterCards: PartnerItem[] = [
  {
    id: 'cc-initial-1',
    name: '林逸 (主角)',
    type: 'character_card',
    content: '',
    fields: {
      age: '18岁',
      gender: '男',
      race: '人类',
      birthplace: '奥兰王国边境小镇',
      occupation: '奥兰魔法学院高级学员',
      socialClass: '平民出身，凭天赋获得奖学金入学',
      identityTags: ['穿越者', '魔法天才', '学院菁英', '求知者'],
      heightBuild: '178cm，体型匀称偏瘦，带有长年钻研书本的学者体格',
      iconicFeatures: '右手手背上隐约有一道淡蓝色的以太回路烙印，紧张时会微微发光',
      clothingStyle: '常穿洗得发白但干净整洁的学院深蓝色长袍，腰间挂着一只用来装施法素材的褐色皮包',
      overallVibe: '举手投足温和沉静，眼神中透着与年龄不符的深邃与冷静，偶尔闪过警惕',
      externalPersonality: '温和谦逊，乐于助人，是老师眼中的好学生、同学眼中的靠谱同伴',
      internalPersonality: '冷静克制，利益权衡明确，心防极重，对周遭一切保持敏锐的审视',
      coreDesire: '探寻这个世界魔法底层的“第一性原理”，并找到安全回家的方法',
      fearWeakness: '害怕自己作为“穿越者”的灵魂秘密被学院高层或神殿看穿并被当成异端净化',
      moralValues: '尊重生命，不主动害人，但当切身安全受威胁时，会毫不犹豫地采取最直接果断的防卫与反击',
      quirk: '思考难题时喜欢下意识地用食指轻敲太阳穴',
      skills: '熟练掌握风系高阶魔法（气流操纵、疾风闪避、风刃）；天生拥有极强的精神感知力，可直观看到以太微粒流动',
      backgroundStory: '一年前意外穿越到这具濒死的魔法学徒身体中。凭借原主的记忆碎片和自己的科学思维，迅速在魔法学院脱颖而出，现正卷入学院深处的以太危机中。',
      relationships: '师导导师：雷文教授（信任且防备）；竞争对手兼好友：大小姐陆雪莹（欢喜冤家，互相欣赏）；死党：胖子唐小山。',
      speakingStyle: '用词严谨，语气不温不火，很少使用情绪化词汇。喜欢用“根据我的观察……”、“通常而言……”开头。',
      typicalReactions: '遭遇危机时：瞳孔微缩但绝不惊慌，退后半步利用环境展开防御，大脑高速运转推演胜率与退路；被夸奖时：礼貌微笑自谦，眼神平静无波。'
    }
  }
];
initialCharacterCards[0].content = compileItemToMarkdown(initialCharacterCards[0].name, 'character_card', initialCharacterCards[0].fields!);

export const usePartnerStore = create<PartnerState>()(
  persist(
    (set) => ({
      worldBooks: initialWorldBooks,
      characterCards: initialCharacterCards,
      selectedId: 'wb-initial-1',
      selectedType: 'world_book',

      addWorldBook: () => set((state) => {
        const newId = `wb-${Date.now()}`;
        const defaultFields: PartnerItemFields = {
          theme: '',
          era: '',
          techLevel: '',
          magicLevel: '',
          geography: '',
          keyScenes: '',
          culturalFeatures: '',
          history: '',
          conflict: ''
        };
        const name = '未命名世界书';
        const content = compileItemToMarkdown(name, 'world_book', defaultFields);
        const newItem: PartnerItem = {
          id: newId,
          name,
          type: 'world_book',
          content,
          fields: defaultFields
        };
        return {
          worldBooks: [...state.worldBooks, newItem],
          selectedId: newId,
          selectedType: 'world_book'
        };
      }),

      addCharacterCard: () => set((state) => {
        const newId = `cc-${Date.now()}`;
        const defaultFields: PartnerItemFields = {
          age: '',
          gender: '',
          race: '',
          birthplace: '',
          occupation: '',
          socialClass: '',
          identityTags: [],
          heightBuild: '',
          iconicFeatures: '',
          clothingStyle: '',
          overallVibe: '',
          externalPersonality: '',
          internalPersonality: '',
          coreDesire: '',
          fearWeakness: '',
          moralValues: '',
          quirk: '',
          skills: '',
          backgroundStory: '',
          relationships: '',
          speakingStyle: '',
          typicalReactions: ''
        };
        const name = '未命名角色卡';
        const content = compileItemToMarkdown(name, 'character_card', defaultFields);
        const newItem: PartnerItem = {
          id: newId,
          name,
          type: 'character_card',
          content,
          fields: defaultFields
        };
        return {
          characterCards: [...state.characterCards, newItem],
          selectedId: newId,
          selectedType: 'character_card'
        };
      }),

      selectItem: (selectedId, selectedType) => set({ selectedId, selectedType }),

      deleteItem: (id, type) => set((state) => {
        const isSelected = state.selectedId === id;
        let newSelectedId = state.selectedId;
        let newSelectedType = state.selectedType;

        const nextWorldBooks = state.worldBooks.filter((item) => item.id !== id);
        const nextCharacterCards = state.characterCards.filter((item) => item.id !== id);

        if (isSelected) {
          if (type === 'world_book' && nextWorldBooks.length > 0) {
            newSelectedId = nextWorldBooks[nextWorldBooks.length - 1].id;
            newSelectedType = 'world_book';
          } else if (type === 'character_card' && nextCharacterCards.length > 0) {
            newSelectedId = nextCharacterCards[nextCharacterCards.length - 1].id;
            newSelectedType = 'character_card';
          } else if (nextWorldBooks.length > 0) {
            newSelectedId = nextWorldBooks[nextWorldBooks.length - 1].id;
            newSelectedType = 'world_book';
          } else if (nextCharacterCards.length > 0) {
            newSelectedId = nextCharacterCards[nextCharacterCards.length - 1].id;
            newSelectedType = 'character_card';
          } else {
            newSelectedId = null;
            newSelectedType = null;
          }
        }

        return {
          worldBooks: nextWorldBooks,
          characterCards: nextCharacterCards,
          selectedId: newSelectedId,
          selectedType: newSelectedType,
        };
      }),

      updateItemName: (id, type, name) => set((state) => {
        if (type === 'world_book') {
          return {
            worldBooks: state.worldBooks.map((item) => {
              if (item.id === id) {
                const nextFields = item.fields || {};
                return {
                  ...item,
                  name,
                  content: compileItemToMarkdown(name, 'world_book', nextFields)
                };
              }
              return item;
            }),
          };
        } else {
          return {
            characterCards: state.characterCards.map((item) => {
              if (item.id === id) {
                const nextFields = item.fields || {};
                return {
                  ...item,
                  name,
                  content: compileItemToMarkdown(name, 'character_card', nextFields)
                };
              }
              return item;
            }),
          };
        }
      }),

      updateItemContent: (id, type, content) => set((state) => {
        if (type === 'world_book') {
          return {
            worldBooks: state.worldBooks.map((item) =>
              item.id === id ? { ...item, content } : item
            ),
          };
        } else {
          return {
            characterCards: state.characterCards.map((item) =>
              item.id === id ? { ...item, content } : item
            ),
          };
        }
      }),

      updateItemFields: (id, type, fields) => set((state) => {
        if (type === 'world_book') {
          return {
            worldBooks: state.worldBooks.map((item) => {
              if (item.id === id) {
                const nextFields = { ...(item.fields || {}), ...fields };
                return {
                  ...item,
                  fields: nextFields,
                  content: compileItemToMarkdown(item.name, 'world_book', nextFields)
                };
              }
              return item;
            }),
          };
        } else {
          return {
            characterCards: state.characterCards.map((item) => {
              if (item.id === id) {
                const nextFields = { ...(item.fields || {}), ...fields };
                return {
                  ...item,
                  fields: nextFields,
                  content: compileItemToMarkdown(item.name, 'character_card', nextFields)
                };
              }
              return item;
            }),
          };
        }
      }),
    }),
    {
      name: 'museai-partner-storage',
    }
  )
);
