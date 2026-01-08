/**
 * WebGL2 GPU Context Implementation
 *
 * Provides GPU operations using the WebGL2 API.
 */

import type { GPUContext } from './GPUContext';
import type {
  GPUTexture,
  GPUTextureDescriptor,
  GPUContextOptions,
  GPUCapabilities,
  ShaderSource,
  CompiledShader,
  UniformValue,
  RenderStats,
  TextureFormat,
} from './types';

// =============================================================================
// WebGL Texture Implementation
// =============================================================================

class WebGLTextureImpl implements GPUTexture {
  id: string;
  width: number;
  height: number;
  format: TextureFormat;
  isDisposed: boolean = false;

  readonly handle: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer | null;

  private gl: WebGL2RenderingContext;

  constructor(
    gl: WebGL2RenderingContext,
    handle: WebGLTexture,
    width: number,
    height: number,
    format: TextureFormat,
    framebuffer: WebGLFramebuffer | null = null
  ) {
    this.gl = gl;
    this.handle = handle;
    this.width = width;
    this.height = height;
    this.format = format;
    this.framebuffer = framebuffer;
    this.id = `tex_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  dispose(): void {
    if (this.isDisposed) return;

    this.gl.deleteTexture(this.handle);
    if (this.framebuffer) {
      this.gl.deleteFramebuffer(this.framebuffer);
    }
    this.isDisposed = true;
  }
}

// =============================================================================
// WebGL Shader Implementation
// =============================================================================

class WebGLShaderImpl implements CompiledShader {
  id: string;
  program: WebGLProgram;
  uniformLocations: Map<string, WebGLUniformLocation>;
  attributeLocations: Map<string, number>;

  constructor(
    program: WebGLProgram,
    uniformLocations: Map<string, WebGLUniformLocation>,
    attributeLocations: Map<string, number>
  ) {
    this.program = program;
    this.uniformLocations = uniformLocations;
    this.attributeLocations = attributeLocations;
    this.id = `shader_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

// =============================================================================
// Default Shaders
// =============================================================================

const DEFAULT_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_texCoord;

out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

const PASSTHROUGH_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_texture;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  fragColor = texture(u_texture, v_texCoord);
}
`;

// =============================================================================
// WebGL2 Context Implementation
// =============================================================================

export class WebGLContext implements GPUContext {
  private gl: WebGL2RenderingContext | null = null;
  private _canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private _isInitialized: boolean = false;
  private _capabilities: GPUCapabilities | null = null;

  // Geometry for fullscreen quad
  private quadVAO: WebGLVertexArrayObject | null = null;
  private quadVBO: WebGLBuffer | null = null;

  // Currently bound shader
  private currentShader: WebGLShaderImpl | null = null;

  // Passthrough shader for blitting
  private passthroughShader: CompiledShader | null = null;

  // Stats tracking
  private stats: RenderStats = {
    drawCalls: 0,
    texturesUsed: 0,
    frameTime: 0,
  };

  // =============================================================================
  // Lifecycle
  // =============================================================================

  async init(options: GPUContextOptions = {}): Promise<void> {
    if (this._isInitialized) return;

    // Create or use provided canvas
    if (options.canvas) {
      this._canvas = options.canvas;
    } else {
      this._canvas = document.createElement('canvas');
    }

    // Get WebGL2 context
    const contextAttributes: WebGLContextAttributes = {
      alpha: true,
      antialias: options.antialias ?? false,
      depth: false,
      stencil: false,
      powerPreference: options.powerPreference ?? 'high-performance',
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      premultipliedAlpha: true,
    };

    this.gl = this._canvas.getContext(
      'webgl2',
      contextAttributes
    ) as WebGL2RenderingContext;

    if (!this.gl) {
      throw new Error('WebGL2 is not supported in this browser');
    }

    // Query capabilities
    this._capabilities = this.queryCapabilities();

    // Initialize fullscreen quad geometry
    this.initQuadGeometry();

    // Set default state
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Mark as initialized BEFORE compiling shaders (compileShader checks this)
    this._isInitialized = true;

    // Compile passthrough shader
    this.passthroughShader = this.compileShader({
      vertex: DEFAULT_VERTEX_SHADER,
      fragment: PASSTHROUGH_FRAGMENT_SHADER,
    });
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  get capabilities(): GPUCapabilities {
    if (!this._capabilities) {
      throw new Error('GPU context not initialized');
    }
    return this._capabilities;
  }

  dispose(): void {
    if (!this._isInitialized || !this.gl) return;

    const gl = this.gl;

    // Delete quad geometry
    if (this.quadVAO) gl.deleteVertexArray(this.quadVAO);
    if (this.quadVBO) gl.deleteBuffer(this.quadVBO);

    // Delete passthrough shader
    if (this.passthroughShader) {
      this.deleteShader(this.passthroughShader);
    }

    // Lose context
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();

    this.gl = null;
    this._canvas = null;
    this._isInitialized = false;
    this._capabilities = null;
  }

  // =============================================================================
  // Texture Management
  // =============================================================================

  createTexture(descriptor: GPUTextureDescriptor): GPUTexture {
    this.ensureInitialized();
    const gl = this.gl!;

    const { width, height, format = 'rgba8' } = descriptor;

    const texture = gl.createTexture();
    if (!texture) throw new Error('Failed to create WebGL texture');

    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Set texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Allocate texture storage
    const { internalFormat, glFormat, type } = this.getTextureFormats(format);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      width,
      height,
      0,
      glFormat,
      type,
      null
    );

    // Create framebuffer for render target usage
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error('Failed to create WebGL framebuffer');

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0
    );

    // Check framebuffer status
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      throw new Error(`Framebuffer incomplete: ${status}`);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return new WebGLTextureImpl(gl, texture, width, height, format, framebuffer);
  }

  uploadImageBitmap(bitmap: ImageBitmap, texture?: GPUTexture): GPUTexture {
    this.ensureInitialized();
    const gl = this.gl!;

    // Create new texture if not provided
    if (!texture) {
      texture = this.createTexture({
        width: bitmap.width,
        height: bitmap.height,
        format: 'rgba8',
      });
    }

    gl.bindTexture(gl.TEXTURE_2D, texture.handle as WebGLTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return texture;
  }

  uploadVideoFrame(frame: VideoFrame, texture?: GPUTexture): GPUTexture {
    this.ensureInitialized();
    const gl = this.gl!;

    // Create new texture if not provided
    if (!texture) {
      texture = this.createTexture({
        width: frame.displayWidth,
        height: frame.displayHeight,
        format: 'rgba8',
      });
    }

    gl.bindTexture(gl.TEXTURE_2D, texture.handle as WebGLTexture);

    // VideoFrame can be uploaded directly in modern browsers
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      frame as unknown as TexImageSource
    );

    gl.bindTexture(gl.TEXTURE_2D, null);

    return texture;
  }

  uploadPixels(
    data: Uint8Array | Float32Array,
    width: number,
    height: number,
    texture?: GPUTexture
  ): GPUTexture {
    this.ensureInitialized();
    const gl = this.gl!;

    const format: TextureFormat = data instanceof Float32Array ? 'rgba32f' : 'rgba8';

    if (!texture) {
      texture = this.createTexture({ width, height, format });
    }

    const { internalFormat, glFormat, type } = this.getTextureFormats(format);

    gl.bindTexture(gl.TEXTURE_2D, texture.handle as WebGLTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      width,
      height,
      0,
      glFormat,
      type,
      data
    );
    gl.bindTexture(gl.TEXTURE_2D, null);

    return texture;
  }

  readPixels(texture: GPUTexture): Uint8Array {
    this.ensureInitialized();
    const gl = this.gl!;

    const data = new Uint8Array(texture.width * texture.height * 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, texture.framebuffer as WebGLFramebuffer);
    gl.readPixels(
      0,
      0,
      texture.width,
      texture.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return data;
  }

  // =============================================================================
  // Shader Management
  // =============================================================================

  compileShader(source: ShaderSource): CompiledShader {
    this.ensureInitialized();
    const gl = this.gl!;

    // Compile vertex shader
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    if (!vertexShader) throw new Error('Failed to create vertex shader');

    gl.shaderSource(vertexShader, source.vertex);
    gl.compileShader(vertexShader);

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(vertexShader);
      gl.deleteShader(vertexShader);
      throw new Error(`Vertex shader compilation failed: ${error}`);
    }

    // Compile fragment shader
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fragmentShader) {
      gl.deleteShader(vertexShader);
      throw new Error('Failed to create fragment shader');
    }

    gl.shaderSource(fragmentShader, source.fragment);
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(fragmentShader);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      throw new Error(`Fragment shader compilation failed: ${error}`);
    }

    // Link program
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      throw new Error('Failed to create shader program');
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    // Shaders can be deleted after linking
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Shader program linking failed: ${error}`);
    }

    // Query uniform locations
    const uniformLocations = new Map<string, WebGLUniformLocation>();
    const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < numUniforms; i++) {
      const info = gl.getActiveUniform(program, i);
      if (info) {
        const location = gl.getUniformLocation(program, info.name);
        if (location) {
          // Remove array suffix for array uniforms
          const name = info.name.replace(/\[0\]$/, '');
          uniformLocations.set(name, location);
        }
      }
    }

    // Query attribute locations
    const attributeLocations = new Map<string, number>();
    const numAttributes = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < numAttributes; i++) {
      const info = gl.getActiveAttrib(program, i);
      if (info) {
        const location = gl.getAttribLocation(program, info.name);
        attributeLocations.set(info.name, location);
      }
    }

    return new WebGLShaderImpl(program, uniformLocations, attributeLocations);
  }

  deleteShader(shader: CompiledShader): void {
    this.ensureInitialized();
    this.gl!.deleteProgram(shader.program as WebGLProgram);
  }

  // =============================================================================
  // Rendering
  // =============================================================================

  setRenderTarget(texture: GPUTexture | null): void {
    this.ensureInitialized();
    const gl = this.gl!;

    if (texture) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, texture.framebuffer as WebGLFramebuffer);
      gl.viewport(0, 0, texture.width, texture.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this._canvas!.width, this._canvas!.height);
    }
  }

  clear(r: number = 0, g: number = 0, b: number = 0, a: number = 0): void {
    this.ensureInitialized();
    const gl = this.gl!;
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  useShader(shader: CompiledShader): void {
    this.ensureInitialized();
    this.gl!.useProgram(shader.program as WebGLProgram);
    this.currentShader = shader as WebGLShaderImpl;
  }

  setUniform(name: string, value: UniformValue): void {
    this.ensureInitialized();
    if (!this.currentShader) {
      throw new Error('No shader is currently bound');
    }

    const gl = this.gl!;
    const location = this.currentShader.uniformLocations.get(name);
    if (!location) return; // Uniform might be optimized out

    if (typeof value === 'number') {
      gl.uniform1f(location, value);
    } else if (typeof value === 'boolean') {
      gl.uniform1i(location, value ? 1 : 0);
    } else if (Array.isArray(value) || value instanceof Float32Array) {
      const arr = Array.isArray(value) ? value : Array.from(value);
      switch (arr.length) {
        case 1:
          gl.uniform1f(location, arr[0]);
          break;
        case 2:
          gl.uniform2fv(location, arr);
          break;
        case 3:
          gl.uniform3fv(location, arr);
          break;
        case 4:
          gl.uniform4fv(location, arr);
          break;
        case 9:
          gl.uniformMatrix3fv(location, false, arr);
          break;
        case 16:
          gl.uniformMatrix4fv(location, false, arr);
          break;
        default:
          console.warn(`Unsupported uniform array length: ${arr.length}`);
      }
    } else if (value instanceof Int32Array) {
      const arr = Array.from(value);
      switch (arr.length) {
        case 1:
          gl.uniform1i(location, arr[0]);
          break;
        case 2:
          gl.uniform2iv(location, arr);
          break;
        case 3:
          gl.uniform3iv(location, arr);
          break;
        case 4:
          gl.uniform4iv(location, arr);
          break;
      }
    }
  }

  bindTexture(texture: GPUTexture, unit: number, uniformName: string): void {
    this.ensureInitialized();
    const gl = this.gl!;

    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture.handle as WebGLTexture);

    if (this.currentShader) {
      const location = this.currentShader.uniformLocations.get(uniformName);
      if (location) {
        gl.uniform1i(location, unit);
      }
    }

    this.stats.texturesUsed++;
  }

  drawFullscreenQuad(): void {
    this.ensureInitialized();
    const gl = this.gl!;

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    this.stats.drawCalls++;
  }

  blitToCanvas(texture: GPUTexture): void {
    this.ensureInitialized();

    // Render to canvas
    this.setRenderTarget(null);
    this.clear(0, 0, 0, 1);

    // Use passthrough shader
    this.useShader(this.passthroughShader!);
    this.bindTexture(texture, 0, 'u_texture');
    this.drawFullscreenQuad();
  }

  copyTexture(src: GPUTexture, dst: GPUTexture): void {
    this.ensureInitialized();

    this.setRenderTarget(dst);
    this.useShader(this.passthroughShader!);
    this.bindTexture(src, 0, 'u_texture');
    this.drawFullscreenQuad();
    this.setRenderTarget(null);
  }

  // =============================================================================
  // Utilities
  // =============================================================================

  get canvas(): HTMLCanvasElement | OffscreenCanvas | null {
    return this._canvas;
  }

  resize(width: number, height: number): void {
    this.ensureInitialized();
    if (this._canvas) {
      this._canvas.width = width;
      this._canvas.height = height;
    }
  }

  getStats(): RenderStats {
    const stats = { ...this.stats };
    // Reset counters for next frame
    this.stats.drawCalls = 0;
    this.stats.texturesUsed = 0;
    return stats;
  }

  flush(): void {
    this.ensureInitialized();
    this.gl!.flush();
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  private ensureInitialized(): void {
    if (!this._isInitialized || !this.gl) {
      throw new Error('GPU context not initialized. Call init() first.');
    }
  }

  private queryCapabilities(): GPUCapabilities {
    const gl = this.gl!;

    // Check float texture support
    const floatTextureExt = gl.getExtension('EXT_color_buffer_float');
    const halfFloatTextureExt = gl.getExtension('EXT_color_buffer_half_float');

    return {
      backend: 'webgl2',
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxTextureUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
      floatTextures: floatTextureExt !== null,
      halfFloatTextures: halfFloatTextureExt !== null,
      renderToFloat: floatTextureExt !== null,
      instancedArrays: true, // Built into WebGL2
    };
  }

  private initQuadGeometry(): void {
    const gl = this.gl!;

    // Fullscreen quad vertices (position + texcoord)
    // prettier-ignore
    const vertices = new Float32Array([
      // Position    TexCoord
      -1, -1,        0, 0,
       1, -1,        1, 0,
      -1,  1,        0, 1,
       1,  1,        1, 1,
    ]);

    // Create VAO
    this.quadVAO = gl.createVertexArray();
    gl.bindVertexArray(this.quadVAO);

    // Create VBO
    this.quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    // Position attribute (location 0)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);

    // TexCoord attribute (location 1)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    gl.bindVertexArray(null);
  }

  private getTextureFormats(format: TextureFormat): {
    internalFormat: GLenum;
    glFormat: GLenum;
    type: GLenum;
  } {
    const gl = this.gl!;

    switch (format) {
      case 'rgba8':
        return {
          internalFormat: gl.RGBA8,
          glFormat: gl.RGBA,
          type: gl.UNSIGNED_BYTE,
        };
      case 'rgba16f':
        return {
          internalFormat: gl.RGBA16F,
          glFormat: gl.RGBA,
          type: gl.HALF_FLOAT,
        };
      case 'rgba32f':
        return {
          internalFormat: gl.RGBA32F,
          glFormat: gl.RGBA,
          type: gl.FLOAT,
        };
      default:
        return {
          internalFormat: gl.RGBA8,
          glFormat: gl.RGBA,
          type: gl.UNSIGNED_BYTE,
        };
    }
  }
}
