/**
 * Abstract GPU Context Interface
 *
 * This interface defines the contract for GPU backends.
 * Implementations: WebGLContext (now), WebGPUContext (future)
 */

import type {
  GPUTexture,
  GPUTextureDescriptor,
  GPUContextOptions,
  GPUCapabilities,
  ShaderSource,
  CompiledShader,
  UniformValue,
  RenderStats,
} from './types';

export interface GPUContext {
  // =============================================================================
  // Lifecycle
  // =============================================================================

  /**
   * Initialize the GPU context
   * @param options Configuration options
   * @returns Promise that resolves when context is ready
   */
  init(options?: GPUContextOptions): Promise<void>;

  /**
   * Check if the context is initialized and ready
   */
  readonly isInitialized: boolean;

  /**
   * Get the capabilities of the current backend
   */
  readonly capabilities: GPUCapabilities;

  /**
   * Dispose of all resources and release the context
   */
  dispose(): void;

  // =============================================================================
  // Texture Management
  // =============================================================================

  /**
   * Create a new texture
   * @param descriptor Texture dimensions and format
   * @returns The created texture
   */
  createTexture(descriptor: GPUTextureDescriptor): GPUTexture;

  /**
   * Upload an ImageBitmap to a GPU texture
   * @param bitmap The source image
   * @param texture Optional existing texture to upload to
   * @returns The texture containing the image data
   */
  uploadImageBitmap(bitmap: ImageBitmap, texture?: GPUTexture): GPUTexture;

  /**
   * Upload a VideoFrame to a GPU texture
   * @param frame The source video frame
   * @param texture Optional existing texture to upload to
   * @returns The texture containing the frame data
   */
  uploadVideoFrame(frame: VideoFrame, texture?: GPUTexture): GPUTexture;

  /**
   * Upload raw pixel data to a texture
   * @param data Pixel data (Uint8Array for rgba8, Float32Array for float formats)
   * @param width Image width
   * @param height Image height
   * @param texture Optional existing texture to upload to
   * @returns The texture containing the pixel data
   */
  uploadPixels(
    data: Uint8Array | Float32Array,
    width: number,
    height: number,
    texture?: GPUTexture
  ): GPUTexture;

  /**
   * Read texture contents back to CPU (slow, use sparingly)
   * @param texture The texture to read
   * @returns Pixel data as Uint8Array (RGBA)
   */
  readPixels(texture: GPUTexture): Uint8Array;

  // =============================================================================
  // Shader Management
  // =============================================================================

  /**
   * Compile a shader program
   * @param source Vertex and fragment shader source code
   * @returns Compiled shader handle
   */
  compileShader(source: ShaderSource): CompiledShader;

  /**
   * Delete a compiled shader program
   * @param shader The shader to delete
   */
  deleteShader(shader: CompiledShader): void;

  // =============================================================================
  // Rendering
  // =============================================================================

  /**
   * Set the render target (framebuffer)
   * @param texture The texture to render to, or null for the canvas
   */
  setRenderTarget(texture: GPUTexture | null): void;

  /**
   * Clear the current render target
   * @param r Red component (0-1)
   * @param g Green component (0-1)
   * @param b Blue component (0-1)
   * @param a Alpha component (0-1)
   */
  clear(r?: number, g?: number, b?: number, a?: number): void;

  /**
   * Bind a shader for rendering
   * @param shader The compiled shader to use
   */
  useShader(shader: CompiledShader): void;

  /**
   * Set a uniform value on the currently bound shader
   * @param name Uniform name
   * @param value Uniform value
   */
  setUniform(name: string, value: UniformValue): void;

  /**
   * Bind a texture to a texture unit
   * @param texture The texture to bind
   * @param unit The texture unit (0-15 typically)
   * @param uniformName The sampler uniform name
   */
  bindTexture(texture: GPUTexture, unit: number, uniformName: string): void;

  /**
   * Draw a fullscreen quad (for post-processing effects)
   */
  drawFullscreenQuad(): void;

  /**
   * Render a texture to the canvas with optional scaling
   * @param texture The texture to display
   */
  blitToCanvas(texture: GPUTexture): void;

  /**
   * Copy one texture to another
   * @param src Source texture
   * @param dst Destination texture
   */
  copyTexture(src: GPUTexture, dst: GPUTexture): void;

  // =============================================================================
  // Utilities
  // =============================================================================

  /**
   * Get the canvas associated with this context
   */
  readonly canvas: HTMLCanvasElement | OffscreenCanvas | null;

  /**
   * Resize the canvas and update viewport
   * @param width New width
   * @param height New height
   */
  resize(width: number, height: number): void;

  /**
   * Get rendering statistics for the last frame
   */
  getStats(): RenderStats;

  /**
   * Flush any pending GPU commands
   */
  flush(): void;
}

/**
 * Check if WebGL2 is supported in this environment
 */
export function isWebGL2Supported(): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  return gl !== null;
}

/**
 * Check if WebGPU is supported in this environment
 */
export async function isWebGPUSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  if (!('gpu' in navigator)) return false;

  try {
    const gpu = (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown | null> } }).gpu;
    const adapter = await gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

/**
 * Get the best available GPU backend
 */
export async function getBestBackend(): Promise<'webgl2' | 'webgpu' | null> {
  // Prefer WebGPU if available (future-proof)
  if (await isWebGPUSupported()) {
    return 'webgpu';
  }

  if (isWebGL2Supported()) {
    return 'webgl2';
  }

  return null;
}
