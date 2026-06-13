import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createDiskStorage } from './diskStorage';
import { Message, AgentSessionSummary, SessionContextCompaction } from './useAgentStore';
import { PartnerItemFields } from './usePartnerStore';
import { createSessionId } from '../utils/sessionIds';

interface PartnerChatState {
  messages: Message[];
  input: string;
  isStreaming: boolean;
  expandedBlocks: Record<string, boolean>;
  selectedWorldBookId: string | null;
  selectedCharacterCardId: string | null;
  userInfo: Partial<PartnerItemFields>;
  sessions: AgentSessionSummary[];
  sessionId: string;
  sessionTitle: string;
  activeRun: { runId: string | null; messageId: string | null };
  isSessionArchived: boolean;
  contextCompaction: SessionContextCompaction | null;

  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  setInput: (input: string) => void;
  setIsStreaming: (isStreaming: boolean) => void;
  setExpandedBlocks: (blocks: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  setSelectedWorldBookId: (id: string | null) => void;
  setSelectedCharacterCardId: (id: string | null) => void;
  setUserInfo: (info: Partial<PartnerItemFields> | ((prev: Partial<PartnerItemFields>) => Partial<PartnerItemFields>)) => void;
  setSessions: (sessions: AgentSessionSummary[]) => void;
  setSessionId: (id: string) => void;
  setSessionTitle: (title: string) => void;
  setActiveRun: (run: { runId: string | null; messageId: string | null }) => void;
  setIsSessionArchived: (val: boolean) => void;
  setContextCompaction: (contextCompaction: SessionContextCompaction | null) => void;
  createNewSession: () => void;
}

export const usePartnerChatStore = create<PartnerChatState>()(
  persist(
    (set) => ({
      messages: [],
      input: '',
      isStreaming: false,
      expandedBlocks: {},
      selectedWorldBookId: null,
      selectedCharacterCardId: null,
      userInfo: {},
      sessions: [],
      sessionId: createSessionId('partner-session'),
      sessionTitle: '新聊天',
      activeRun: { runId: null, messageId: null },
      isSessionArchived: false,
      contextCompaction: null,

      setMessages: (updater) => set((state) => ({
        messages: typeof updater === 'function' ? updater(state.messages) : updater,
      })),
      setInput: (input) => set({ input }),
      setIsStreaming: (isStreaming) => set({ isStreaming }),
      setExpandedBlocks: (updater) => set((state) => ({
        expandedBlocks: typeof updater === 'function' ? updater(state.expandedBlocks) : updater,
      })),
      setSelectedWorldBookId: (selectedWorldBookId) => set({ selectedWorldBookId }),
      setSelectedCharacterCardId: (selectedCharacterCardId) => set({ selectedCharacterCardId }),
      setUserInfo: (updater) => set((state) => ({
        userInfo: typeof updater === 'function' ? updater(state.userInfo) : updater,
      })),
      setSessions: (sessions) => set({ sessions }),
      setSessionId: (sessionId) => set({ sessionId }),
      setSessionTitle: (sessionTitle) => set({ sessionTitle }),
      setActiveRun: (activeRun) => set({ activeRun }),
      setIsSessionArchived: (isSessionArchived) => set({ isSessionArchived }),
      setContextCompaction: (contextCompaction) => set({ contextCompaction }),

      createNewSession: () => {
        set(() => ({
          activeRun: { runId: null, messageId: null },
          messages: [],
          input: '',
          isStreaming: false,
          expandedBlocks: {},
          sessionId: createSessionId('partner-session'),
          sessionTitle: '新聊天',
          isSessionArchived: false,
          contextCompaction: null,
        }));
      },
    }),
    {
      name: 'museai-partner-chat-storage',
      storage: createJSONStorage(() => createDiskStorage('partner-chat-store', 'museai-partner-chat-storage')),
      merge: (persistedState, currentState) => {
        const state = persistedState as Partial<PartnerChatState> | undefined;
        return {
          ...currentState,
          selectedWorldBookId: state?.selectedWorldBookId ?? currentState.selectedWorldBookId,
          selectedCharacterCardId: state?.selectedCharacterCardId ?? currentState.selectedCharacterCardId,
          userInfo: state?.userInfo ?? currentState.userInfo,
        };
      },
      partialize: (state) => ({
        selectedWorldBookId: state.selectedWorldBookId,
        selectedCharacterCardId: state.selectedCharacterCardId,
        userInfo: state.userInfo,
      }),
    }
  )
);
