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
  signature?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  thinking?: string;
  thinkingBlocks?: ThinkingBlock[];
  tools?: AgentToolEntry[];
  articleType?: string;
  suggestedChoices?: string[];
}

export interface AgentTodo {
  content: string;
  status: string;
}

export interface SessionContextCompaction {
  summary: string;
  compactedThroughMessageId?: string | null;
  compactedThroughIndex: number;
  sourceMessageCount: number;
  updatedAt: number;
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
  sessionKind?: 'chat' | 'story' | 'bookTravel';
  characterCardId?: string | null;
  characterCardIds?: string[] | null;
  selectedWorldBookId?: string | null;
  dynamicRoleLoadingEnabled?: boolean;
}

export interface AgentSessionRecord extends AgentSessionSummary {
  messages: Message[];
  selectedReferenceFiles: string[];
  selectedOutlineFile?: string | null;
  todos: AgentTodo[];
  contextCompaction?: SessionContextCompaction | null;
  isArchived?: boolean;
  characterCardId?: string | null;
  characterCardIds?: string[] | null;
  selectedWorldBookId?: string | null;
  dynamicRoleLoadingEnabled?: boolean;
  bookTravelState?: unknown;
}

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `session-${crypto.randomUUID()}`;
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}


interface AgentStoreState {
  messages: Message[];
  input: string;
  isStreaming: boolean;
  expandedBlocks: Record<string, boolean>;
  selectedReferenceFiles: string[];
  selectedOutlineFile: string | null;
  todos: AgentTodo[];
  contextCompaction: SessionContextCompaction | null;
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
  setSelectedOutlineFile: (file: string | null) => void;
  setTodos: (todos: AgentTodo[]) => void;
  setContextCompaction: (contextCompaction: SessionContextCompaction | null) => void;
  setIsTodoOpen: (isOpen: boolean | ((prev: boolean) => boolean)) => void;
  setSessions: (sessions: AgentSessionSummary[]) => void;
  setSkills: (skills: SkillDefinition[]) => void;
  setSessionId: (id: string) => void;
  setSessionTitle: (title: string) => void;
  setActiveRun: (run: { runId: string | null; messageId: string | null }) => void;

  createNewSession: () => void;
}

import { persist, createJSONStorage } from 'zustand/middleware';
import { createDiskStorage } from './diskStorage';

export const useAgentStore = create<AgentStoreState>()(
  persist(
    (set) => ({
      messages: [],
      input: '',
      isStreaming: false,
      expandedBlocks: {},
      selectedReferenceFiles: [],
      selectedOutlineFile: null,
      todos: [],
      contextCompaction: null,
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
      setSelectedOutlineFile: (selectedOutlineFile) => set({ selectedOutlineFile }),
      setTodos: (todos) => set({ todos }),
      setContextCompaction: (contextCompaction) => set({ contextCompaction }),
      setIsTodoOpen: (updater) => set((state) => ({
        isTodoOpen: typeof updater === 'function' ? updater(state.isTodoOpen) : updater,
      })),
      setSessions: (sessions) => set({ sessions }),
      setSkills: (skills) => set({ skills }),
      setSessionId: (sessionId) => set({ sessionId }),
      setSessionTitle: (sessionTitle) => set({ sessionTitle }),
      setActiveRun: (activeRun) => set({ activeRun }),

      createNewSession: () => {
        set((state) => ({
          activeRun: { runId: null, messageId: null },
          messages: [],
          input: '',
          isStreaming: false,
          expandedBlocks: {},
          selectedReferenceFiles: state.selectedReferenceFiles,
          selectedOutlineFile: state.selectedOutlineFile,
          todos: [],
          contextCompaction: null,
          isTodoOpen: false,
          sessionId: createSessionId(),
          sessionTitle: '新对话',
        }));
      },
    }),
    {
      name: 'museai-agent-storage',
      storage: createJSONStorage(() => createDiskStorage('agent-store', 'museai-agent-storage')),
      partialize: (state) => ({
        selectedReferenceFiles: state.selectedReferenceFiles,
        selectedOutlineFile: state.selectedOutlineFile,
      }),
    }
  )
);
