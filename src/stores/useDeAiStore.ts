import { create } from 'zustand';
import { Message } from './useAgentStore';

interface AgentRunState {
  runId: string | null;
  messageId: string | null;
}

interface DeAiState {
  selectedWorkFile: string | null;
  selectedReferenceFile: string | null;
  activePreviewFile: string | null;
  activeVersionId: string | null;
  versions: any[];
  suggestion: string | null;
  aiScore: number | null;
  parsedScoreResult: any | null;
  carryOverHistoricalSuggestions: boolean;
  detectorRunning: boolean;
  removerRunning: boolean;
  detectorMessages: Message[];
  removerMessages: Message[];
  detectorRun: AgentRunState;
  removerRun: AgentRunState;
  selectedDetectorReferences: string[];
  detectorSelectedHistoricalVersions: string[];
  removerSelectedHistoricalVersions: string[];
  isDetectorOpen: boolean;
  isRemoverVisible: boolean;
  setSelectedWorkFile: (file: string | null) => void;
  setSelectedReferenceFile: (file: string | null) => void;
  setActivePreviewFile: (file: string | null) => void;
  setActiveVersionId: (id: string | null) => void;
  setVersions: (versions: any[]) => void;
  setSuggestion: (suggestion: string | null) => void;
  setAiScore: (score: number | null) => void;
  setParsedScoreResult: (result: any | null) => void;
  setCarryOverHistoricalSuggestions: (carry: boolean) => void;
  setDetectorRunning: (isRunning: boolean) => void;
  setRemoverRunning: (isRunning: boolean) => void;
  setDetectorMessages: (messages: Message[] | ((messages: Message[]) => Message[])) => void;
  setRemoverMessages: (messages: Message[] | ((messages: Message[]) => Message[])) => void;
  setDetectorRun: (run: AgentRunState) => void;
  setRemoverRun: (run: AgentRunState) => void;
  setSelectedDetectorReferences: (references: string[] | ((references: string[]) => string[])) => void;
  setDetectorSelectedHistoricalVersions: (versions: string[] | ((versions: string[]) => string[])) => void;
  setRemoverSelectedHistoricalVersions: (versions: string[] | ((versions: string[]) => string[])) => void;
  setIsDetectorOpen: (isOpen: boolean) => void;
  setIsRemoverVisible: (isVisible: boolean) => void;
}

import { persist, createJSONStorage } from 'zustand/middleware';
import { createDiskStorage } from './diskStorage';

export const useDeAiStore = create<DeAiState>()(
  persist(
    (set) => ({
      selectedWorkFile: null,
      selectedReferenceFile: null,
      activePreviewFile: null,
      activeVersionId: null,
      versions: [],
      suggestion: null,
      aiScore: null,
      parsedScoreResult: null,
      carryOverHistoricalSuggestions: false,
      detectorRunning: false,
      removerRunning: false,
      detectorMessages: [],
      removerMessages: [],
      detectorRun: { runId: null, messageId: null },
      removerRun: { runId: null, messageId: null },
      selectedDetectorReferences: [],
      detectorSelectedHistoricalVersions: [],
      removerSelectedHistoricalVersions: [],
      isDetectorOpen: false,
      isRemoverVisible: true,
      setSelectedWorkFile: (file) => set({ selectedWorkFile: file, selectedReferenceFile: null, activePreviewFile: file, activeVersionId: null, versions: [], suggestion: null, aiScore: null, parsedScoreResult: null }),
      setSelectedReferenceFile: (file) => set({ selectedWorkFile: null, selectedReferenceFile: file, activePreviewFile: file, activeVersionId: null, versions: [], suggestion: null, aiScore: null, parsedScoreResult: null }),
      setActivePreviewFile: (file) => set({ activePreviewFile: file }),
      setActiveVersionId: (id) => set({ activeVersionId: id }),
      setVersions: (versions) => set({ versions }),
      setSuggestion: (suggestion) => set({ suggestion }),
      setAiScore: (score) => set({ aiScore: score }),
      setParsedScoreResult: (parsedScoreResult) => set({ parsedScoreResult }),
      setCarryOverHistoricalSuggestions: (carry) => set({ carryOverHistoricalSuggestions: carry }),
      setDetectorRunning: (detectorRunning) => set({ detectorRunning }),
      setRemoverRunning: (removerRunning) => set({ removerRunning }),
      setDetectorMessages: (messages) => set((state) => ({
        detectorMessages: typeof messages === 'function' ? messages(state.detectorMessages) : messages,
      })),
      setRemoverMessages: (messages) => set((state) => ({
        removerMessages: typeof messages === 'function' ? messages(state.removerMessages) : messages,
      })),
      setDetectorRun: (detectorRun) => set({ detectorRun }),
      setRemoverRun: (removerRun) => set({ removerRun }),
      setSelectedDetectorReferences: (references) => set((state) => ({
        selectedDetectorReferences: typeof references === 'function' ? references(state.selectedDetectorReferences) : references,
      })),
      setDetectorSelectedHistoricalVersions: (versions) => set((state) => ({
        detectorSelectedHistoricalVersions: typeof versions === 'function' ? versions(state.detectorSelectedHistoricalVersions) : versions,
      })),
      setRemoverSelectedHistoricalVersions: (versions) => set((state) => ({
        removerSelectedHistoricalVersions: typeof versions === 'function' ? versions(state.removerSelectedHistoricalVersions) : versions,
      })),
      setIsDetectorOpen: (isDetectorOpen) => set({ isDetectorOpen }),
      setIsRemoverVisible: (isRemoverVisible) => set({ isRemoverVisible }),
    }),
    {
      name: 'museai-deai-storage',
      storage: createJSONStorage(() => createDiskStorage('deai-store', 'museai-deai-storage')),
      partialize: (state) => ({
        selectedDetectorReferences: state.selectedDetectorReferences,
        carryOverHistoricalSuggestions: state.carryOverHistoricalSuggestions,
        detectorSelectedHistoricalVersions: state.detectorSelectedHistoricalVersions,
        removerSelectedHistoricalVersions: state.removerSelectedHistoricalVersions,
      }),
    }
  )
);
