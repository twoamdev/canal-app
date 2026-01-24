import { create } from 'zustand';
import { useAssetStore } from './assetStore';
import { useCompositionStore } from './compositionStore';
import { isCompositionAsset } from '../types/assets';

interface TimelineState {
  // Current frame position
  currentFrame: number;

  // Frame range (synced with active composition's work area)
  frameStart: number;
  frameEnd: number;

  // Playback state
  isPlaying: boolean;
  isLooping: boolean;
  fps: number;

  // Trigger that increments when playback pauses - unselected nodes subscribe to this
  // to know when to update their display without subscribing to currentFrame
  pauseTrigger: number;

  // Actions
  setCurrentFrame: (frame: number) => void;
  setFrameRange: (start: number, end: number) => void;
  setIsPlaying: (playing: boolean) => void;
  togglePlayback: () => void;
  setIsLooping: (looping: boolean) => void;
  toggleLooping: () => void;
  setFps: (fps: number) => void;
  /** Trigger pause update - increments pauseTrigger to signal nodes to refresh */
  triggerPauseUpdate: () => void;

  // Frame navigation
  nextFrame: () => void;
  prevFrame: () => void;
  goToStart: () => void;
  goToEnd: () => void;

  // Composition sync
  syncWithComposition: () => void;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({

  // Initial state
  currentFrame: 1,
  frameStart: 1,
  frameEnd: 300, // 300 frames (1-300)
  isPlaying: false,
  isLooping: true,
  fps: 30,
  pauseTrigger: 0,

  // Actions
  setCurrentFrame: (frame) => {
    const { frameStart, frameEnd } = get();
    // Clamp to valid range
    const clampedFrame = Math.max(frameStart, Math.min(frameEnd, Math.round(frame)));
    set({ currentFrame: clampedFrame });
  },

  setFrameRange: (start, end) => {
    const { currentFrame } = get();
    set({
      frameStart: start,
      frameEnd: end,
      // Clamp current frame to new range
      currentFrame: Math.max(start, Math.min(end, currentFrame))
    });

    // Update the active composition's work area
    const compositionId = useCompositionStore.getState().activeCompositionId;
    if (compositionId) {
      const asset = useAssetStore.getState().getAsset(compositionId);
      if (asset && isCompositionAsset(asset)) {
        useAssetStore.getState().updateAsset(compositionId, {
          workAreaStart: start,
          workAreaEnd: end,
          // Also update durationFrames if end is larger
          durationFrames: Math.max(asset.durationFrames, end),
        });
      }
    }
  },

  setIsPlaying: (playing) => {
    const wasPlaying = get().isPlaying;
    // Increment pauseTrigger when playback stops to signal unselected nodes to update
    if (wasPlaying && !playing) {
      set((state) => ({ isPlaying: playing, pauseTrigger: state.pauseTrigger + 1 }));
    } else {
      set({ isPlaying: playing });
    }
  },

  togglePlayback: () => {
    const { isPlaying, pauseTrigger } = get();
    // Increment pauseTrigger when playback stops
    if (isPlaying) {
      set({ isPlaying: false, pauseTrigger: pauseTrigger + 1 });
    } else {
      set({ isPlaying: true });
    }
  },

  setIsLooping: (looping) => set({ isLooping: looping }),

  toggleLooping: () => set((state) => ({ isLooping: !state.isLooping })),

  setFps: (fps) => set({ fps: Math.max(1, fps) }),

  triggerPauseUpdate: () => set((state) => ({ pauseTrigger: state.pauseTrigger + 1 })),

  // Frame navigation
  nextFrame: () => {
    const { currentFrame, frameEnd, frameStart, isLooping } = get();
    if (currentFrame >= frameEnd) {
      if (isLooping) {
        set({ currentFrame: frameStart });
      }
    } else {
      set({ currentFrame: currentFrame + 1 });
    }
  },

  prevFrame: () => {
    const { currentFrame, frameStart, frameEnd, isLooping } = get();
    if (currentFrame <= frameStart) {
      if (isLooping) {
        set({ currentFrame: frameEnd });
      }
    } else {
      set({ currentFrame: currentFrame - 1 });
    }
  },

  goToStart: () => {
    const { frameStart } = get();
    set({ currentFrame: frameStart });
  },

  goToEnd: () => {
    const { frameEnd } = get();
    set({ currentFrame: frameEnd });
  },

  // Sync timeline with the active composition's work area
  syncWithComposition: () => {
    const compositionId = useCompositionStore.getState().activeCompositionId;
    if (!compositionId) return;

    const asset = useAssetStore.getState().getAsset(compositionId);
    if (!asset || !isCompositionAsset(asset)) return;

    const { currentFrame } = get();

    // Handle legacy compositions that don't have workAreaStart/workAreaEnd
    const newStart = asset.workAreaStart ?? 0;
    const newEnd = asset.workAreaEnd ?? asset.durationFrames;

    // If the composition is missing these fields, update it
    if (asset.workAreaStart === undefined || asset.workAreaEnd === undefined) {
      useAssetStore.getState().updateAsset(compositionId, {
        workAreaStart: newStart,
        workAreaEnd: newEnd,
      });
    }

    set({
      frameStart: newStart,
      frameEnd: newEnd,
      fps: asset.fps,
      // Clamp current frame to new range
      currentFrame: Math.max(newStart, Math.min(newEnd, currentFrame)),
    });
  },
}));

// =============================================================================
// Initialization Helper
// =============================================================================

/**
 * Initialize timeline from the active composition
 * Call this after composition system is initialized
 */
export function initializeTimelineFromComposition(): void {
  // Small delay to ensure composition store is ready
  setTimeout(() => {
  
    useTimelineStore.getState().syncWithComposition();
  }, 10);
}
