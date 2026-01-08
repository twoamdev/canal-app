/**
 * GPU Abstraction Layer Types
 *
 * These types define the interface for GPU operations, designed to be
 * backend-agnostic (WebGL now, WebGPU later).
 */

// =============================================================================
// Texture Types
// =============================================================================

export interface GPUTextureDescriptor {
  width: number;
  height: number;
  format?: TextureFormat;
  usage?: TextureUsage;
}

export type TextureFormat = 'rgba8' | 'rgba16f' | 'rgba32f';

export type TextureUsage = 'render-target' | 'sampler' | 'both';

export interface GPUTexture {
  id: string;
  width: number;
  height: number;
  format: TextureFormat;

  // Backend-specific handle (WebGLTexture or GPUTexture)
  readonly handle: unknown;

  // For render targets, the associated framebuffer
  readonly framebuffer?: unknown;

  // Lifecycle
  isDisposed: boolean;
  dispose(): void;
}

// =============================================================================
// Shader Types
// =============================================================================

export interface ShaderSource {
  vertex: string;
  fragment: string;
}

export interface CompiledShader {
  id: string;
  program: unknown;  // WebGLProgram or GPUShaderModule
  uniformLocations: Map<string, unknown>;
  attributeLocations: Map<string, number>;
}

// =============================================================================
// Uniform Types
// =============================================================================

export type UniformValue =
  | number
  | number[]
  | Float32Array
  | Int32Array
  | boolean;

export interface UniformDescriptor {
  name: string;
  type: UniformType;
  default?: UniformValue;
}

export type UniformType =
  | 'float'
  | 'int'
  | 'bool'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'mat2'
  | 'mat3'
  | 'mat4'
  | 'sampler2D';

// =============================================================================
// Effect Types
// =============================================================================

export interface EffectDefinition {
  name: string;
  displayName: string;
  category: EffectCategory;

  // Number of input textures (1 for most effects, 2+ for composite/blend)
  inputCount: number;

  // Parameter definitions
  parameters: ParameterDefinition[];

  // Shader source (GLSL for now)
  fragmentShader: string;

  // Optional custom vertex shader (default is passthrough)
  vertexShader?: string;
}

export type EffectCategory =
  | 'color'
  | 'blur'
  | 'distort'
  | 'stylize'
  | 'composite'
  | 'transform';

export interface ParameterDefinition {
  name: string;
  displayName: string;
  type: ParameterType;
  default: number | number[] | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: number }[];  // For enum-like params
}

export type ParameterType =
  | 'float'
  | 'int'
  | 'bool'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'color'  // vec3 or vec4 with color picker UI
  | 'angle'  // float with angle UI (degrees)
  | 'enum';  // int with dropdown UI

// =============================================================================
// Render Types
// =============================================================================

export interface RenderPass {
  effect: string;  // Effect name from registry
  inputs: GPUTexture[];
  output: GPUTexture;
  parameters: Record<string, UniformValue>;
}

export interface RenderStats {
  drawCalls: number;
  texturesUsed: number;
  frameTime: number;  // ms
}

// =============================================================================
// Context Types
// =============================================================================

export type GPUBackend = 'webgl2' | 'webgpu';

export interface GPUContextOptions {
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  preferredBackend?: GPUBackend;
  powerPreference?: 'default' | 'high-performance' | 'low-power';
  antialias?: boolean;
  preserveDrawingBuffer?: boolean;
}

export interface GPUCapabilities {
  backend: GPUBackend;
  maxTextureSize: number;
  maxTextureUnits: number;
  floatTextures: boolean;
  halfFloatTextures: boolean;
  renderToFloat: boolean;
  instancedArrays: boolean;
}

// =============================================================================
// Cache Types
// =============================================================================

export interface TexturePoolOptions {
  maxTextures?: number;
  maxMemoryBytes?: number;
}

export interface TexturePoolStats {
  activeTextures: number;
  pooledTextures: number;
  totalMemoryBytes: number;
}

// =============================================================================
// Dirty Tracking Types
// =============================================================================

export interface NodeRenderState {
  nodeId: string;
  outputTexture: GPUTexture | null;
  lastRenderedFrame: number;
  parameterHash: string;
  isDirty: boolean;
}

export interface RenderCacheEntry {
  texture: GPUTexture;
  frameIndex: number;
  parameterHash: string;
  timestamp: number;
}
