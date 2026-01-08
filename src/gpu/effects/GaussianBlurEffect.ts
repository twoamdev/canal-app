/**
 * Gaussian Blur Effect
 *
 * Two-pass separable Gaussian blur for efficient, high-quality blurring.
 */

import { Effect, DEFAULT_VERTEX_SHADER, SHADER_COMMON } from './Effect';
import { effectRegistry } from './registry';
import type { GPUContext } from '../GPUContext';
import type { GPUTexture, EffectDefinition, CompiledShader } from '../types';

const BLUR_FRAGMENT_SHADER = `
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform vec2 u_direction;  // (1,0) for horizontal, (0,1) for vertical
uniform float u_radius;    // Blur radius in pixels

// Gaussian weight function
float gaussian(float x, float sigma) {
  return exp(-(x * x) / (2.0 * sigma * sigma));
}

void main() {
  vec2 texelSize = 1.0 / u_resolution;
  vec4 color = vec4(0.0);
  float totalWeight = 0.0;

  // Sigma is approximately radius / 3 for good Gaussian approximation
  float sigma = max(u_radius / 3.0, 0.001);

  // For performance, limit samples based on radius
  // At radius 1, we need ~3 samples. At radius 50, we need ~101 samples.
  // We'll cap at 127 samples for shader performance
  int halfSamples = min(int(ceil(u_radius)), 63);

  for (int i = -halfSamples; i <= halfSamples; i++) {
    float offset = float(i);
    float weight = gaussian(offset, sigma);

    vec2 samplePos = v_texCoord + u_direction * texelSize * offset;
    color += texture(u_texture, samplePos) * weight;
    totalWeight += weight;
  }

  fragColor = color / totalWeight;
}
`;

const definition: EffectDefinition = {
  name: 'gaussianBlur',
  displayName: 'Gaussian Blur',
  category: 'blur',
  inputCount: 1,
  parameters: [
    {
      name: 'radius',
      displayName: 'Radius',
      type: 'float',
      default: 10,
      min: 0,
      max: 100,
      step: 0.5,
    },
  ],
  fragmentShader: BLUR_FRAGMENT_SHADER,
};

export class GaussianBlurEffect extends Effect {
  private blurShader: CompiledShader | null = null;
  private tempTexture: GPUTexture | null = null;

  constructor() {
    super(definition);
  }

  /**
   * Compile the blur shader
   */
  compile(context: GPUContext): void {
    if (this.blurShader) return;

    this.blurShader = context.compileShader({
      vertex: DEFAULT_VERTEX_SHADER,
      fragment: SHADER_COMMON + '\n' + BLUR_FRAGMENT_SHADER,
    });
  }

  /**
   * Dispose of GPU resources
   */
  dispose(context: GPUContext): void {
    if (this.blurShader) {
      context.deleteShader(this.blurShader);
      this.blurShader = null;
    }
    if (this.tempTexture) {
      this.tempTexture.dispose();
      this.tempTexture = null;
    }
  }

  /**
   * Apply the two-pass Gaussian blur
   */
  apply(
    context: GPUContext,
    inputs: GPUTexture[],
    output: GPUTexture
  ): void {
    if (!this.blurShader) {
      throw new Error('GaussianBlurEffect not compiled');
    }

    const input = inputs[0];
    const radius = this.getParameter<number>('radius') ?? 10;

    // Skip blur if radius is 0
    if (radius <= 0) {
      context.copyTexture(input, output);
      return;
    }

    // Ensure we have a temp texture for the intermediate result
    if (
      !this.tempTexture ||
      this.tempTexture.width !== input.width ||
      this.tempTexture.height !== input.height
    ) {
      if (this.tempTexture) {
        this.tempTexture.dispose();
      }
      this.tempTexture = context.createTexture({
        width: input.width,
        height: input.height,
        format: input.format,
      });
    }

    // Pass 1: Horizontal blur (input -> temp)
    context.setRenderTarget(this.tempTexture);
    context.clear(0, 0, 0, 0);
    context.useShader(this.blurShader);
    context.bindTexture(input, 0, 'u_texture');
    context.setUniform('u_resolution', [input.width, input.height]);
    context.setUniform('u_direction', [1.0, 0.0]);
    context.setUniform('u_radius', radius);
    context.drawFullscreenQuad();

    // Pass 2: Vertical blur (temp -> output)
    context.setRenderTarget(output);
    context.clear(0, 0, 0, 0);
    context.useShader(this.blurShader);
    context.bindTexture(this.tempTexture, 0, 'u_texture');
    context.setUniform('u_resolution', [input.width, input.height]);
    context.setUniform('u_direction', [0.0, 1.0]);
    context.setUniform('u_radius', radius);
    context.drawFullscreenQuad();

    // Reset render target
    context.setRenderTarget(null);
  }
}

// Register the effect
effectRegistry.register(definition, GaussianBlurEffect as never);
