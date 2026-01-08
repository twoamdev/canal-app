/**
 * GPU Module
 *
 * Provides GPU-accelerated graphics processing for the motion design app.
 *
 * Architecture:
 * - GPUContext: Abstract interface for GPU operations
 * - WebGLContext: WebGL2 implementation (current)
 * - TexturePool: Efficient texture allocation with LRU eviction
 * - Effects: Shader-based image/video effects
 *
 * Usage:
 * ```typescript
 * import { useGPUStore } from '../stores/gpuStore';
 * import { effectRegistry } from '../gpu';
 *
 * // Initialize GPU
 * const { initialize, getContext } = useGPUStore();
 * await initialize();
 *
 * // Get context
 * const ctx = getContext();
 *
 * // Apply an effect
 * const blur = effectRegistry.getCompiled('gaussianBlur', ctx);
 * blur.setParameter('radius', 15);
 * blur.apply(ctx, [inputTexture], outputTexture);
 * ```
 */

// Core GPU context
export { isWebGL2Supported, isWebGPUSupported, getBestBackend } from './GPUContext';
export type { GPUContext } from './GPUContext';
export { WebGLContext } from './WebGLContext';

// Texture management
export { TexturePool } from './TexturePool';

// Types
export type {
  GPUTexture,
  GPUTextureDescriptor,
  TextureFormat,
  TextureUsage,
  ShaderSource,
  CompiledShader,
  UniformValue,
  UniformDescriptor,
  UniformType,
  EffectDefinition,
  EffectCategory,
  ParameterDefinition,
  ParameterType,
  RenderPass,
  RenderStats,
  GPUBackend,
  GPUContextOptions,
  GPUCapabilities,
  TexturePoolOptions,
  TexturePoolStats,
  NodeRenderState,
  RenderCacheEntry,
} from './types';

// Effects system
export {
  Effect,
  DEFAULT_VERTEX_SHADER,
  SHADER_COMMON,
  effectRegistry,
  ColorAdjustEffect,
  GaussianBlurEffect,
} from './effects';

// Render pipeline
export { RenderPipeline } from './RenderPipeline';
export type { RenderNode, PipelineStats } from './RenderPipeline';
