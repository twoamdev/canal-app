/**
 * GPU Store
 *
 * Manages the singleton GPU context and texture pool.
 * Provides centralized access to GPU resources across the app.
 */

import { create } from 'zustand';
import type { GPUContext } from '../gpu/GPUContext';
import { WebGLContext } from '../gpu/WebGLContext';
import { TexturePool } from '../gpu/TexturePool';
import type {
  GPUCapabilities,
  GPUContextOptions,
  TexturePoolStats,
  GPUTexture,
  TextureFormat,
} from '../gpu/types';

interface GPUState {
  // State
  isInitialized: boolean;
  isInitializing: boolean;
  error: string | null;
  capabilities: GPUCapabilities | null;

  // Context and pool (not serialized)
  context: GPUContext | null;
  texturePool: TexturePool | null;

  // Actions
  initialize: (options?: GPUContextOptions) => Promise<void>;
  dispose: () => void;

  // Texture pool helpers
  acquireTexture: (
    width: number,
    height: number,
    format?: TextureFormat
  ) => GPUTexture | null;
  releaseTexture: (texture: GPUTexture) => void;
  getPoolStats: () => TexturePoolStats | null;

  // Utility
  getContext: () => GPUContext | null;
}

export const useGPUStore = create<GPUState>()((set, get) => ({
  // Initial state
  isInitialized: false,
  isInitializing: false,
  error: null,
  capabilities: null,
  context: null,
  texturePool: null,

  // Initialize the GPU context
  initialize: async (options?: GPUContextOptions) => {
    const state = get();

    // Already initialized or initializing
    if (state.isInitialized || state.isInitializing) {
      return;
    }

    set({ isInitializing: true, error: null });

    try {
      // Create WebGL context
      const context = new WebGLContext();
      await context.init(options);

      // Create texture pool
      const texturePool = new TexturePool(context, {
        maxTextures: 64,
        maxMemoryBytes: 512 * 1024 * 1024, // 512MB
      });

      set({
        context,
        texturePool,
        capabilities: context.capabilities,
        isInitialized: true,
        isInitializing: false,
        error: null,
      });

      console.log('[GPU] Initialized successfully', context.capabilities);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      set({
        isInitializing: false,
        error: message,
      });
      console.error('[GPU] Initialization failed:', message);
      throw error;
    }
  },

  // Dispose of all GPU resources
  dispose: () => {
    const { context, texturePool } = get();

    if (texturePool) {
      texturePool.clearAll();
    }

    if (context) {
      context.dispose();
    }

    set({
      context: null,
      texturePool: null,
      capabilities: null,
      isInitialized: false,
      error: null,
    });

    console.log('[GPU] Disposed');
  },

  // Acquire a texture from the pool
  acquireTexture: (
    width: number,
    height: number,
    format: TextureFormat = 'rgba8'
  ) => {
    const { texturePool } = get();
    if (!texturePool) return null;
    return texturePool.acquire(width, height, format);
  },

  // Release a texture back to the pool
  releaseTexture: (texture: GPUTexture) => {
    const { texturePool } = get();
    if (!texturePool) return;
    texturePool.release(texture);
  },

  // Get texture pool statistics
  getPoolStats: () => {
    const { texturePool } = get();
    if (!texturePool) return null;
    return texturePool.getStats();
  },

  // Get the GPU context
  getContext: () => {
    return get().context;
  },
}));

/**
 * Hook to ensure GPU is initialized before use
 */
export function useGPUContext(): GPUContext | null {
  const { context, isInitialized, initialize } = useGPUStore();

  // Auto-initialize if not done
  if (!isInitialized) {
    initialize().catch(console.error);
  }

  return context;
}

/**
 * Get the GPU context synchronously (for use outside React)
 */
export function getGPUContext(): GPUContext | null {
  return useGPUStore.getState().context;
}

/**
 * Get the texture pool synchronously (for use outside React)
 */
export function getTexturePool(): TexturePool | null {
  return useGPUStore.getState().texturePool;
}
