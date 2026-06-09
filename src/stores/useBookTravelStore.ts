import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createDiskStorage } from './diskStorage';

export interface BookTravelMaterial {
  id: string;
  title: string;
  content?: string;
  path?: string;
}

export interface BookTravelEntryPoint {
  id: string;
  title: string;
  summary: string;
  timeAndLocation?: string;
  situation?: string;
  initialGoal?: string;
  risk?: string;
}

export interface BookTravelUserCharacter {
  name: string;
  identity: string;
  background?: string;
  personality?: string;
  goal: string;
}

export interface BookTravelBeat {
  id: string;
  content: string;
}

export interface BookTravelScene {
  id: string;
  title: string;
  summary?: string;
  currentSituation?: string;
  time?: string;
  location?: string;
  activeCharacters?: string[];
  beats: BookTravelBeat[];
}

export interface BookTravelTurnSnapshot {
  id: string;
  userInput: string;
  classification: 'meta' | 'insert-beat' | 'change-scene';
  plannerOutput?: unknown;
  narrativeOutput: string;
  stateSnapshot: unknown;
  createdSceneId?: string;
  createdBeatIds: string[];
}

export interface BookTravelEnding {
  finalEnding: string;
  userKeyChoices?: string[];
  originalOutlineComparison?: string;
  characterOutcomes?: string[];
  worldlineName: string;
  divergenceScore: number;
}

export interface ResolvedMaterials {
  outline: BookTravelMaterial;
  worldBook: BookTravelMaterial;
  characterCards: BookTravelMaterial[];
}

export interface BookTravelAssembledMaterial {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  materials: ResolvedMaterials;
  assembledWorldModel: unknown;
  stableMemory: unknown | null;
  volatileMemory: Record<string, unknown> | null;
  entryPoints: BookTravelEntryPoint[];
  recommendedUserCharacters: BookTravelUserCharacter[];
}

export type BookTravelAssembledMaterialInput = Omit<BookTravelAssembledMaterial, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string;
  createdAt?: number;
  updatedAt?: number;
};

export interface BookTravelSnapshot {
  selectedOutline: BookTravelMaterial | null;
  selectedWorldBook: BookTravelMaterial | null;
  selectedCharacterCards: BookTravelMaterial[];
  assembledWorldModel: unknown | null;
  stableMemory: unknown | null;
  volatileMemory: Record<string, unknown> | null;
  entryPoints: BookTravelEntryPoint[];
  recommendedUserCharacters: BookTravelUserCharacter[];
  selectedEntryPointId: string | null;
  userCharacter: BookTravelUserCharacter | null;
  currentState: unknown | null;
  scenes: BookTravelScene[];
  currentSceneId: string | null;
  currentBeatId: string | null;
  turns: BookTravelTurnSnapshot[];
  summaryMemory: string;
  isCompleted: boolean;
  ending: BookTravelEnding | null;
}

interface BookTravelState extends BookTravelSnapshot {
  assembledMaterials: BookTravelAssembledMaterial[];
  selectedMaterialId: string | null;
  selectOutline: (outline: BookTravelMaterial | null) => void;
  selectWorldBook: (worldBook: BookTravelMaterial | null) => void;
  setSelectedCharacterCards: (characterCards: BookTravelMaterial[]) => void;
  setResolvedMaterials: (materials: ResolvedMaterials) => void;
  setAssembledWorldModel: (assembledWorldModel: unknown) => void;
  setStableMemory: (stableMemory: unknown) => void;
  updateVolatileMemory: (patch: Record<string, unknown>) => void;
  setEntryPoints: (entryPoints: BookTravelEntryPoint[]) => void;
  setRecommendedUserCharacters: (recommendedUserCharacters: BookTravelUserCharacter[]) => void;
  setSelectedEntryPointId: (selectedEntryPointId: string | null) => void;
  setUserCharacter: (userCharacter: BookTravelUserCharacter | null) => void;
  setCurrentState: (currentState: unknown) => void;
  addScene: (scene: BookTravelScene) => void;
  addBeatToCurrentScene: (beat: BookTravelBeat) => void;
  setCurrentBeatId: (beatId: string | null) => void;
  advanceBeat: (sceneId: string, beatId: string) => void;
  appendTurn: (turn: BookTravelTurnSnapshot) => void;
  removeLastTurn: () => void;
  removeLastBeatFromCurrentScene: () => void;
  updateSummaryMemory: (summaryMemory: string) => void;
  finishSession: (ending: BookTravelEnding) => void;
  saveAssembledMaterial: (material: BookTravelAssembledMaterialInput) => string;
  updateAssembledMaterial: (id: string, patch: Partial<BookTravelAssembledMaterialInput>) => void;
  deleteAssembledMaterial: (id: string) => void;
  loadAssembledMaterial: (id: string) => void;
  restoreSession: (snapshot: Partial<BookTravelSnapshot>) => void;
  resetSession: () => void;
}

const initialState = {
  selectedOutline: null,
  selectedWorldBook: null,
  selectedCharacterCards: [],
  assembledWorldModel: null,
  stableMemory: null,
  volatileMemory: null,
  entryPoints: [],
  recommendedUserCharacters: [],
  selectedEntryPointId: null,
  userCharacter: null,
  currentState: null,
  scenes: [],
  currentSceneId: null,
  currentBeatId: null,
  turns: [],
  summaryMemory: '',
  isCompleted: false,
  ending: null,
};

const materialId = () => `book-travel-material-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const loadMaterialIntoSession = (material: BookTravelAssembledMaterial): Partial<BookTravelState> => ({
  ...initialState,
  selectedMaterialId: material.id,
  selectedOutline: material.materials.outline,
  selectedWorldBook: material.materials.worldBook,
  selectedCharacterCards: material.materials.characterCards,
  assembledWorldModel: material.assembledWorldModel,
  stableMemory: material.stableMemory,
  volatileMemory: material.volatileMemory,
  entryPoints: material.entryPoints,
  recommendedUserCharacters: material.recommendedUserCharacters,
  selectedEntryPointId: material.entryPoints[0]?.id ?? null,
  userCharacter: material.recommendedUserCharacters[0] ?? null,
});

export const useBookTravelStore = create<BookTravelState>()(
  persist(
    (set, get) => ({
      ...initialState,
      assembledMaterials: [],
      selectedMaterialId: null,

      selectOutline: (selectedOutline) => set({ selectedOutline }),
      selectWorldBook: (selectedWorldBook) => set({ selectedWorldBook }),
      setSelectedCharacterCards: (selectedCharacterCards) => set({ selectedCharacterCards }),
      setResolvedMaterials: ({ outline, worldBook, characterCards }) => set({
        selectedOutline: outline,
        selectedWorldBook: worldBook,
        selectedCharacterCards: characterCards,
      }),
      setAssembledWorldModel: (assembledWorldModel) => set({ assembledWorldModel }),
      setStableMemory: (stableMemory) => set({ stableMemory }),
      updateVolatileMemory: (patch) => set((state) => ({
        volatileMemory: {
          ...(state.volatileMemory || {}),
          ...patch,
        },
      })),
      setEntryPoints: (entryPoints) => set({ entryPoints }),
      setRecommendedUserCharacters: (recommendedUserCharacters) => set({ recommendedUserCharacters }),
      setSelectedEntryPointId: (selectedEntryPointId) => set({ selectedEntryPointId }),
      setUserCharacter: (userCharacter) => set({ userCharacter }),
      setCurrentState: (currentState) => set({ currentState }),
      addScene: (scene) => set((state) => ({
        scenes: [...state.scenes.filter((item) => item.id !== scene.id), scene],
        currentSceneId: scene.id,
        currentBeatId: scene.beats[0]?.id ?? null,
      })),
      addBeatToCurrentScene: (beat) => set((state) => {
        const sceneIndex = state.scenes.findIndex((s) => s.id === state.currentSceneId);
        if (sceneIndex === -1) return state;
        const newScenes = [...state.scenes];
        const scene = newScenes[sceneIndex];
        newScenes[sceneIndex] = {
          ...scene,
          beats: [...scene.beats, beat],
        };
        return { scenes: newScenes };
      }),
      setCurrentBeatId: (currentBeatId) => set({ currentBeatId }),
      advanceBeat: (currentSceneId, currentBeatId) => set({ currentSceneId, currentBeatId }),
      appendTurn: (turn) => set((state) => ({ turns: [...state.turns, turn] })),
      removeLastTurn: () => set((state) => ({ turns: state.turns.slice(0, -1) })),
      removeLastBeatFromCurrentScene: () => set((state) => {
        const sceneIndex = state.scenes.findIndex((s) => s.id === state.currentSceneId);
        if (sceneIndex === -1) return {};
        const newScenes = [...state.scenes];
        const scene = newScenes[sceneIndex];
        const newBeats = scene.beats.slice(0, -1);
        newScenes[sceneIndex] = { ...scene, beats: newBeats };
        const newBeatId = newBeats.length > 0 ? newBeats[newBeats.length - 1].id : null;
        return { scenes: newScenes, currentBeatId: newBeatId };
      }),
      updateSummaryMemory: (summaryMemory) => set({ summaryMemory }),
      finishSession: (ending) => set({ ending, isCompleted: true }),
      saveAssembledMaterial: (input) => {
        const now = Date.now();
        const id = input.id || materialId();
        const material: BookTravelAssembledMaterial = {
          ...input,
          id,
          createdAt: input.createdAt || now,
          updatedAt: input.updatedAt || now,
        };
        set((state) => ({
          assembledMaterials: [
            material,
            ...state.assembledMaterials.filter((item) => item.id !== id),
          ],
        }));
        return id;
      },
      updateAssembledMaterial: (id, patch) => set((state) => ({
        assembledMaterials: state.assembledMaterials.map((item) => (
          item.id === id
            ? { ...item, ...patch, id, updatedAt: Date.now() }
            : item
        )),
      })),
      deleteAssembledMaterial: (id) => set((state) => ({
        assembledMaterials: state.assembledMaterials.filter((item) => item.id !== id),
        selectedMaterialId: state.selectedMaterialId === id ? null : state.selectedMaterialId,
      })),
      loadAssembledMaterial: (id) => {
        const material = get().assembledMaterials.find((item) => item.id === id);
        if (!material) return;
        set(loadMaterialIntoSession(material));
      },
      restoreSession: (snapshot) => set({ ...initialState, ...snapshot }),
      resetSession: () => set({ ...initialState, selectedMaterialId: null }),
    }),
    {
      name: 'museai-book-travel-storage',
      storage: createJSONStorage(() => createDiskStorage('book-travel-store', 'museai-book-travel-storage')),
      partialize: (state) => ({
        assembledMaterials: state.assembledMaterials,
      }),
    },
  ),
);

export const getBookTravelSnapshot = (): BookTravelSnapshot => {
  const state = useBookTravelStore.getState();
  return {
    selectedOutline: state.selectedOutline,
    selectedWorldBook: state.selectedWorldBook,
    selectedCharacterCards: state.selectedCharacterCards,
    assembledWorldModel: state.assembledWorldModel,
    stableMemory: state.stableMemory,
    volatileMemory: state.volatileMemory,
    entryPoints: state.entryPoints,
    recommendedUserCharacters: state.recommendedUserCharacters,
    selectedEntryPointId: state.selectedEntryPointId,
    userCharacter: state.userCharacter,
    currentState: state.currentState,
    scenes: state.scenes,
    currentSceneId: state.currentSceneId,
    currentBeatId: state.currentBeatId,
    turns: state.turns,
    summaryMemory: state.summaryMemory,
    isCompleted: state.isCompleted,
    ending: state.ending,
  };
};
