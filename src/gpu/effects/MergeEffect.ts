/**
 * Merge Effect
 *
 * Composites two layers with various blend modes.
 * Input 0 = background (bg), Input 1 = foreground (fg)
 * Output dimensions = bg dimensions, fg is centered on bg.
 */

import { Effect } from './Effect';
import { effectRegistry } from './registry';
import type { EffectDefinition } from '../types';
import type { GPUContext } from '../GPUContext';

const FRAGMENT_SHADER = `
uniform sampler2D u_texture;   // Background (input 0)
uniform sampler2D u_texture1;  // Foreground (input 1)
uniform vec2 u_resolution;     // Output resolution (bg dimensions)
uniform vec2 u_fgSize;         // Foreground dimensions
uniform int u_blendMode;       // 0=over, 1=under, 2=add, 3=subtract, 4=screen, 5=overlay
uniform float u_opacity;       // Foreground opacity

// Blend mode functions
vec3 blendAdd(vec3 bg, vec3 fg) {
  return min(bg + fg, 1.0);
}

vec3 blendSubtract(vec3 bg, vec3 fg) {
  return max(bg - fg, 0.0);
}

vec3 blendScreen(vec3 bg, vec3 fg) {
  return 1.0 - (1.0 - bg) * (1.0 - fg);
}

vec3 blendOverlay(vec3 bg, vec3 fg) {
  vec3 result;
  result.r = bg.r < 0.5 ? 2.0 * bg.r * fg.r : 1.0 - 2.0 * (1.0 - bg.r) * (1.0 - fg.r);
  result.g = bg.g < 0.5 ? 2.0 * bg.g * fg.g : 1.0 - 2.0 * (1.0 - bg.g) * (1.0 - fg.g);
  result.b = bg.b < 0.5 ? 2.0 * bg.b * fg.b : 1.0 - 2.0 * (1.0 - bg.b) * (1.0 - fg.b);
  return result;
}

void main() {
  vec2 bgCoord = v_texCoord;
  vec4 bgColor = texture(u_texture, bgCoord);

  // Calculate fg coordinate (centered on bg)
  vec2 bgPixel = v_texCoord * u_resolution;
  vec2 fgOffset = (u_resolution - u_fgSize) * 0.5;
  vec2 fgPixel = bgPixel - fgOffset;
  vec2 fgCoord = fgPixel / u_fgSize;

  // Check if we're within fg bounds
  bool inFgBounds = fgCoord.x >= 0.0 && fgCoord.x <= 1.0 &&
                    fgCoord.y >= 0.0 && fgCoord.y <= 1.0;

  vec4 fgColor = vec4(0.0);
  if (inFgBounds) {
    fgColor = texture(u_texture1, fgCoord);
    fgColor.a *= u_opacity;
  }

  vec3 result;
  float alpha;

  if (u_blendMode == 0) {
    // Over: standard alpha composite (fg over bg)
    result = fgColor.rgb * fgColor.a + bgColor.rgb * (1.0 - fgColor.a);
    alpha = fgColor.a + bgColor.a * (1.0 - fgColor.a);
  }
  else if (u_blendMode == 1) {
    // Under: bg over fg
    result = bgColor.rgb * bgColor.a + fgColor.rgb * (1.0 - bgColor.a);
    alpha = bgColor.a + fgColor.a * (1.0 - bgColor.a);
  }
  else if (u_blendMode == 2) {
    // Add
    result = blendAdd(bgColor.rgb, fgColor.rgb * fgColor.a);
    alpha = max(bgColor.a, fgColor.a);
  }
  else if (u_blendMode == 3) {
    // Subtract
    result = blendSubtract(bgColor.rgb, fgColor.rgb * fgColor.a);
    alpha = bgColor.a;
  }
  else if (u_blendMode == 4) {
    // Screen
    vec3 blended = blendScreen(bgColor.rgb, fgColor.rgb);
    result = mix(bgColor.rgb, blended, fgColor.a);
    alpha = max(bgColor.a, fgColor.a);
  }
  else if (u_blendMode == 5) {
    // Overlay
    vec3 blended = blendOverlay(bgColor.rgb, fgColor.rgb);
    result = mix(bgColor.rgb, blended, fgColor.a);
    alpha = max(bgColor.a, fgColor.a);
  }
  else {
    // Fallback: over
    result = fgColor.rgb * fgColor.a + bgColor.rgb * (1.0 - fgColor.a);
    alpha = fgColor.a + bgColor.a * (1.0 - fgColor.a);
  }

  fragColor = vec4(result, alpha);
}
`;

const definition: EffectDefinition = {
  name: 'merge',
  displayName: 'Merge',
  category: 'composite',
  inputCount: 2, // bg + fg
  parameters: [
    {
      name: 'blendMode',
      displayName: 'Blend Mode',
      type: 'int',
      default: 0,
      min: 0,
      max: 5,
      step: 1,
    },
    {
      name: 'opacity',
      displayName: 'FG Opacity',
      type: 'float',
      default: 1.0,
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      name: 'fgSize',
      displayName: 'FG Size',
      type: 'vec2',
      default: [1920, 1080],
    },
  ],
  fragmentShader: FRAGMENT_SHADER,
};

// Map string blend mode to int for shader
const BLEND_MODE_MAP: Record<string, number> = {
  over: 0,
  under: 1,
  add: 2,
  subtract: 3,
  screen: 4,
  overlay: 5,
};

export class MergeEffect extends Effect {
  constructor() {
    super(definition);
  }

  /**
   * Override to handle integer uniform for blendMode
   */
  protected applyParameters(context: GPUContext): void {
    for (const [name, value] of this.parameters) {
      if (name === 'blendMode') {
        // Pass as Int32Array so setUniform uses gl.uniform1i
        context.setUniform(`u_${name}`, new Int32Array([value as number]));
      } else {
        context.setUniform(`u_${name}`, value);
      }
    }
  }
}

// Export the blend mode map for use by the renderer
export { BLEND_MODE_MAP };

// Register the effect
effectRegistry.register(definition, MergeEffect as never);
