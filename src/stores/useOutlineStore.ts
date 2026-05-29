import { create } from 'zustand';
import { Message } from './useAgentStore';

interface AgentRunState {
  runId: string | null;
  messageId: string | null;
}

interface OutlineState {
  selectedOutlineFile: string | null;
  activePreviewFile: string | null;
  activeVersionId: string | null;
  versions: any[];
  suggestion: string | null;

  creationSelectedOutlineFile: string | null;
  creationActiveVersionId: string | null;
  creationVersions: any[];
  
  assessmentRunning: boolean;
  creationRunning: boolean;
  creationInput: string;
  isCreationStreaming: boolean;
  creationExpandedBlocks: Record<string, boolean>;
  creationTodos: any[];
  isCreationTodoOpen: boolean;
  creationSelectedReferenceFiles: string[];

  fileTreeWidth: number;
  agentWidth: number;
  isAgentVisible: boolean;
  
  assessmentMessages: Message[];
  creationMessages: Message[];
  
  assessmentRun: AgentRunState;
  creationRun: AgentRunState;
  
  setSelectedOutlineFile: (file: string | null) => void;
  setActivePreviewFile: (file: string | null) => void;
  setActiveVersionId: (id: string | null) => void;
  setVersions: (versions: any[]) => void;
  setSuggestion: (suggestion: string | null) => void;

  setCreationSelectedOutlineFile: (file: string | null) => void;
  setCreationActiveVersionId: (id: string | null) => void;
  setCreationVersions: (versions: any[]) => void;
  
  setAssessmentRunning: (isRunning: boolean) => void;
  setCreationRunning: (isRunning: boolean) => void;
  setCreationInput: (input: string) => void;
  setIsCreationStreaming: (isStreaming: boolean) => void;
  setCreationExpandedBlocks: (blocks: Record<string, boolean> | ((blocks: Record<string, boolean>) => Record<string, boolean>)) => void;
  setCreationTodos: (todos: any[]) => void;
  setIsCreationTodoOpen: (isOpen: boolean | ((isOpen: boolean) => boolean)) => void;
  setCreationSelectedReferenceFiles: (files: string[]) => void;

  setFileTreeWidth: (width: number) => void;
  setAgentWidth: (width: number) => void;
  setIsAgentVisible: (isVisible: boolean) => void;
  
  setAssessmentMessages: (messages: Message[] | ((messages: Message[]) => Message[])) => void;
  setCreationMessages: (messages: Message[] | ((messages: Message[]) => Message[])) => void;
  
  setAssessmentRun: (run: AgentRunState) => void;
  setCreationRun: (run: AgentRunState) => void;
}

import { persist } from 'zustand/middleware';

export const useOutlineStore = create<OutlineState>()(
  persist(
    (set) => ({
      selectedOutlineFile: null,
      activePreviewFile: null,
      activeVersionId: null,
      versions: [],
      suggestion: null,

      creationSelectedOutlineFile: null,
      creationActiveVersionId: null,
      creationVersions: [],
      
      assessmentRunning: false,
      creationRunning: false,
      creationInput: '',
      isCreationStreaming: false,
      creationExpandedBlocks: {},
      creationTodos: [],
      isCreationTodoOpen: false,
      creationSelectedReferenceFiles: [],

      fileTreeWidth: 280,
      agentWidth: 420,
      isAgentVisible: true,
      
      assessmentMessages: [],
      creationMessages: [],
      
      assessmentRun: { runId: null, messageId: null },
      creationRun: { runId: null, messageId: null },
      
      setSelectedOutlineFile: (file) => set({ 
        selectedOutlineFile: file, 
        activePreviewFile: file, 
        activeVersionId: null, 
        versions: [], 
        suggestion: null,
      }),
      setActivePreviewFile: (file) => set({ activePreviewFile: file }),
      setActiveVersionId: (id) => set({ activeVersionId: id }),
      setVersions: (versions) => set({ versions }),
      setSuggestion: (suggestion) => set({ suggestion }),

      setCreationSelectedOutlineFile: (file) => set({
        creationSelectedOutlineFile: file,
        creationActiveVersionId: null,
        creationVersions: [],
      }),
      setCreationActiveVersionId: (id) => set({ creationActiveVersionId: id }),
      setCreationVersions: (versions) => set({ creationVersions: versions }),
      
      setAssessmentRunning: (assessmentRunning) => set({ assessmentRunning }),
      setCreationRunning: (creationRunning) => set({ creationRunning }),
      setCreationInput: (creationInput) => set({ creationInput }),
      setIsCreationStreaming: (isCreationStreaming) => set({ isCreationStreaming }),
      setCreationExpandedBlocks: (blocks) => set((state) => ({
        creationExpandedBlocks: typeof blocks === 'function' ? blocks(state.creationExpandedBlocks) : blocks,
      })),
      setCreationTodos: (creationTodos) => set({ creationTodos }),
      setIsCreationTodoOpen: (isOpen) => set((state) => ({
        isCreationTodoOpen: typeof isOpen === 'function' ? isOpen(state.isCreationTodoOpen) : isOpen,
      })),
      setCreationSelectedReferenceFiles: (creationSelectedReferenceFiles) => set({ creationSelectedReferenceFiles }),

      setFileTreeWidth: (fileTreeWidth) => set({ fileTreeWidth }),
      setAgentWidth: (agentWidth) => set({ agentWidth }),
      setIsAgentVisible: (isAgentVisible) => set({ isAgentVisible }),
      
      setAssessmentMessages: (messages) => set((state) => ({
        assessmentMessages: typeof messages === 'function' ? messages(state.assessmentMessages) : messages,
      })),
      setCreationMessages: (messages) => set((state) => ({
        creationMessages: typeof messages === 'function' ? messages(state.creationMessages) : messages,
      })),
      
      setAssessmentRun: (assessmentRun) => set({ assessmentRun }),
      setCreationRun: (creationRun) => set({ creationRun }),
    }),
    {
      name: 'museai-outline-storage',
      partialize: (state) => ({
        creationSelectedReferenceFiles: state.creationSelectedReferenceFiles,
      }),
    }
  )
);
