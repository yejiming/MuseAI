import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createDiskStorage } from './diskStorage';
import type { Key } from 'react';
import type { Message } from './useAgentStore';

interface AgentRunState {
  runId: string | null;
  messageId: string | null;
}

export interface WorkSummaryResult {
  scoreJson: string;
  updatedAt: number;
}

interface WorksState {
  selectedFile: string | null;
  selectedDirectory: string | null;
  fileTreeWidth: number;
  agentWidth: number;
  isAgentVisible: boolean;
  isWorkSummaryOpen: boolean;
  expandedKeys: Key[];
  workSummarySelectedArticlePaths: string[];
  workSummaryMessages: Message[];
  workSummaryRunning: boolean;
  workSummaryRun: AgentRunState;
  workSummaryResults: Record<string, WorkSummaryResult>;
  setSelectedFile: (file: string | null) => void;
  setSelectedDirectory: (directory: string | null) => void;
  setFileTreeWidth: (width: number) => void;
  setAgentWidth: (width: number) => void;
  setIsAgentVisible: (visible: boolean) => void;
  setIsWorkSummaryOpen: (visible: boolean) => void;
  setExpandedKeys: (keys: Key[]) => void;
  setWorkSummarySelectedArticlePaths: (paths: string[]) => void;
  setWorkSummaryMessages: (messages: Message[] | ((messages: Message[]) => Message[])) => void;
  setWorkSummaryRunning: (running: boolean) => void;
  setWorkSummaryRun: (run: AgentRunState) => void;
  setWorkSummaryResult: (path: string, result: WorkSummaryResult) => void;
  setWorkSummaryResults: (results: Record<string, WorkSummaryResult>) => void;
}

export const useWorksStore = create<WorksState>()(
  persist(
    (set) => ({
      selectedFile: null,
      selectedDirectory: null,
      fileTreeWidth: 250,
      agentWidth: 420,
      isAgentVisible: true,
      isWorkSummaryOpen: false,
      expandedKeys: [],
      workSummarySelectedArticlePaths: [],
      workSummaryMessages: [],
      workSummaryRunning: false,
      workSummaryRun: { runId: null, messageId: null },
      workSummaryResults: {},
      setSelectedFile: (selectedFile) => set({ selectedFile }),
      setSelectedDirectory: (selectedDirectory) => set({ selectedDirectory }),
      setFileTreeWidth: (fileTreeWidth) => set({ fileTreeWidth }),
      setAgentWidth: (agentWidth) => set({ agentWidth }),
      setIsAgentVisible: (isAgentVisible) => set({ isAgentVisible }),
      setIsWorkSummaryOpen: (isWorkSummaryOpen) => set({ isWorkSummaryOpen }),
      setExpandedKeys: (expandedKeys) => set({ expandedKeys }),
      setWorkSummarySelectedArticlePaths: (workSummarySelectedArticlePaths) => set({ workSummarySelectedArticlePaths }),
      setWorkSummaryMessages: (messages) => set((state) => ({
        workSummaryMessages: typeof messages === 'function' ? messages(state.workSummaryMessages) : messages,
      })),
      setWorkSummaryRunning: (workSummaryRunning) => set({ workSummaryRunning }),
      setWorkSummaryRun: (workSummaryRun) => set({ workSummaryRun }),
      setWorkSummaryResult: (path, result) => set((state) => ({
        workSummaryResults: {
          ...state.workSummaryResults,
          [path]: result,
        },
      })),
      setWorkSummaryResults: (workSummaryResults) => set({ workSummaryResults }),
    }),
    {
      name: 'museai-works-storage',
      storage: createJSONStorage(() => createDiskStorage('works-store', 'museai-works-storage')),
      partialize: (state) => ({
        workSummarySelectedArticlePaths: state.workSummarySelectedArticlePaths,
        workSummaryResults: state.workSummaryResults,
      }),
    }
  )
);
