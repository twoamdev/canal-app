import { create } from 'zustand';

interface TimelineState {
  // Current frame position
  currentFrame: number;

  // Frame range
  frameStart: number;
  frameEnd: number;

  // Playback state
  isPlaying: boolean;
  isLooping: boolean;
  fps: number;

  // Actions
  setCurrentFrame: (frame: number) => void;
  setFrameRange: (start: number, end: number) => void;
  setIsPlaying: (playing: boolean) => void;
  togglePlayback: () => void;
  setIsLooping: (looping: boolean) => void;
  toggleLooping: () => void;
  setFps: (fps: number) => void;

  // Frame navigation
  nextFrame: () => void;
  prevFrame: () => void;
  goToStart: () => void;
  goToEnd: () => void;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  // Initial state
  currentFrame: 0,
  frameStart: 0,
  frameEnd: 299, // 300 frames (0-299)
  isPlaying: false,
  isLooping: true,
  fps: 30,

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
  },

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  togglePlayback: () => set((state) => ({ isPlaying: !state.isPlaying })),

  setIsLooping: (looping) => set({ isLooping: looping }),

  toggleLooping: () => set((state) => ({ isLooping: !state.isLooping })),

  setFps: (fps) => set({ fps: Math.max(1, fps) }),

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
}));
