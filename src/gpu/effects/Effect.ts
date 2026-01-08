/**
 * Effect Base Class
 *
 * Defines the interface for GPU effects and provides common functionality.
 */

import type { GPUContext } from '../GPUContext';
import type {
  GPUTexture,
  EffectDefinition,
  ParameterDefinition,
  CompiledShader,
  UniformValue,
} from '../types';

// Default vertex shader for fullscreen effects
export const DEFAULT_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_texCoord;

out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

// Common shader utilities to prepend to all fragment shaders
export const SHADER_COMMON = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

// Common utility functions
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float luminance(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}
`;

export abstract class Effect {
  readonly definition: EffectDefinition;
  protected shader: CompiledShader | null = null;
  protected parameters: Map<string, UniformValue> = new Map();

  constructor(definition: EffectDefinition) {
    this.definition = definition;

    // Initialize parameters with defaults
    for (const param of definition.parameters) {
      this.parameters.set(param.name, param.default);
    }
  }

  /**
   * Get the effect name
   */
  get name(): string {
    return this.definition.name;
  }

  /**
   * Get the display name
   */
  get displayName(): string {
    return this.definition.displayName;
  }

  /**
   * Get parameter definitions
   */
  get parameterDefs(): ParameterDefinition[] {
    return this.definition.parameters;
  }

  /**
   * Get a parameter value
   */
  getParameter<T extends UniformValue>(name: string): T | undefined {
    return this.parameters.get(name) as T | undefined;
  }

  /**
   * Set a parameter value
   */
  setParameter(name: string, value: UniformValue): void {
    this.parameters.set(name, value);
  }

  /**
   * Set multiple parameters at once
   */
  setParameters(params: Record<string, UniformValue>): void {
    for (const [name, value] of Object.entries(params)) {
      this.parameters.set(name, value);
    }
  }

  /**
   * Get all current parameter values
   */
  getParameters(): Record<string, UniformValue> {
    const result: Record<string, UniformValue> = {};
    for (const [name, value] of this.parameters) {
      result[name] = value;
    }
    return result;
  }

  /**
   * Generate a hash of current parameters (for caching)
   */
  getParameterHash(): string {
    const values = Array.from(this.parameters.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
      .join('|');
    return values;
  }

  /**
   * Compile the effect shader
   */
  compile(context: GPUContext): void {
    if (this.shader) return;

    const vertexShader =
      this.definition.vertexShader ?? DEFAULT_VERTEX_SHADER;
    const fragmentShader = SHADER_COMMON + '\n' + this.definition.fragmentShader;

    this.shader = context.compileShader({
      vertex: vertexShader,
      fragment: fragmentShader,
    });
  }

  /**
   * Dispose of GPU resources
   */
  dispose(context: GPUContext): void {
    if (this.shader) {
      context.deleteShader(this.shader);
      this.shader = null;
    }
  }

  /**
   * Apply the effect
   * @param context GPU context
   * @param inputs Input textures
   * @param output Output texture
   */
  apply(
    context: GPUContext,
    inputs: GPUTexture[],
    output: GPUTexture
  ): void {
    if (!this.shader) {
      throw new Error(`Effect "${this.name}" not compiled`);
    }

    if (inputs.length < this.definition.inputCount) {
      throw new Error(
        `Effect "${this.name}" requires ${this.definition.inputCount} inputs, got ${inputs.length}`
      );
    }

    // Set render target
    context.setRenderTarget(output);
    context.clear(0, 0, 0, 0);

    // Use shader
    context.useShader(this.shader);

    // Bind input textures
    for (let i = 0; i < inputs.length; i++) {
      context.bindTexture(inputs[i], i, `u_texture${i === 0 ? '' : i}`);
    }

    // Set resolution uniform (commonly needed)
    context.setUniform('u_resolution', [output.width, output.height]);

    // Set effect-specific parameters
    this.applyParameters(context);

    // Draw
    context.drawFullscreenQuad();

    // Reset render target
    context.setRenderTarget(null);
  }

  /**
   * Apply effect-specific parameters to the shader
   * Override in subclasses for custom parameter handling
   */
  protected applyParameters(context: GPUContext): void {
    for (const [name, value] of this.parameters) {
      context.setUniform(`u_${name}`, value);
    }
  }
}
