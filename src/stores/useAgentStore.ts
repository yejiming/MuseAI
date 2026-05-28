import { create } from 'zustand';

export interface AgentToolEntry {
  id?: string;
  name: string;
  result: string;
  status?: string;
  arguments?: string;
}

export interface ThinkingBlock {
  id: string;
  content: string;
}

export interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  thinking?: string;
  thinkingBlocks?: ThinkingBlock[];
  tools?: AgentToolEntry[];
  articleType?: string;
}

export interface AgentTodo {
  content: string;
  status: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
  path: string;
}

export interface AgentSessionSummary {
  id: string;
  title: string;
  savedAt: number;
}

export interface AgentSessionRecord extends AgentSessionSummary {
  messages: Message[];
  selectedReferenceFiles: string[];
  todos: AgentTodo[];
}

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const createWelcomeMessage = (): Message => ({
  id: 'welcome',
  role: 'agent',
  content: '你好！我是 MuseAI 的 Agent 助手。我可以帮助你构思剧情、修改文本或执行本地工具。有什么我可以帮忙的吗？',
});

interface AgentStoreState {
  messages: Message[];
  input: string;
  isStreaming: boolean;
  expandedBlocks: Record<string, boolean>;
  selectedReferenceFiles: string[];
  todos: AgentTodo[];
  isTodoOpen: boolean;
  sessions: AgentSessionSummary[];
  skills: SkillDefinition[];
  sessionId: string;
  sessionTitle: string;
  activeRun: { runId: string | null; messageId: string | null };

  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  setInput: (input: string) => void;
  setIsStreaming: (isStreaming: boolean) => void;
  setExpandedBlocks: (blocks: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  setSelectedReferenceFiles: (files: string[]) => void;
  setTodos: (todos: AgentTodo[]) => void;
  setIsTodoOpen: (isOpen: boolean | ((prev: boolean) => boolean)) => void;
  setSessions: (sessions: AgentSessionSummary[]) => void;
  setSkills: (skills: SkillDefinition[]) => void;
  setSessionId: (id: string) => void;
  setSessionTitle: (title: string) => void;
  setActiveRun: (run: { runId: string | null; messageId: string | null }) => void;

  createNewSession: () => void;
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  messages: [createWelcomeMessage()],
  input: '',
  isStreaming: false,
  expandedBlocks: {},
  selectedReferenceFiles: [],
  todos: [],
  isTodoOpen: false,
  sessions: [],
  skills: [],
  sessionId: createSessionId(),
  sessionTitle: '新对话',
  activeRun: { runId: null, messageId: null },

  setMessages: (updater) => set((state) => ({
    messages: typeof updater === 'function' ? updater(state.messages) : updater,
  })),
  setInput: (input) => set({ input }),
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  setExpandedBlocks: (updater) => set((state) => ({
    expandedBlocks: typeof updater === 'function' ? updater(state.expandedBlocks) : updater,
  })),
  setSelectedReferenceFiles: (selectedReferenceFiles) => set({ selectedReferenceFiles }),
  setTodos: (todos) => set({ todos }),
  setIsTodoOpen: (updater) => set((state) => ({
    isTodoOpen: typeof updater === 'function' ? updater(state.isTodoOpen) : updater,
  })),
  setSessions: (sessions) => set({ sessions }),
  setSkills: (skills) => set({ skills }),
  setSessionId: (sessionId) => set({ sessionId }),
  setSessionTitle: (sessionTitle) => set({ sessionTitle }),
  setActiveRun: (activeRun) => set({ activeRun }),

  createNewSession: () => {
    set({
      activeRun: { runId: null, messageId: null },
      messages: [createWelcomeMessage()],
      input: '',
      isStreaming: false,
      expandedBlocks: {},
      selectedReferenceFiles: [],
      todos: [],
      isTodoOpen: false,
      sessionId: createSessionId(),
      sessionTitle: '新对话',
    });
  },
}));
