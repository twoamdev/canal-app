/**
 * Color Adjustment Effect
 *
 * Adjusts brightness, contrast, saturation, and exposure.
 */

import { Effect } from './Effect';
import { effectRegistry } from './registry';
import type { EffectDefinition } from '../types';

const FRAGMENT_SHADER = `
uniform sampler2D u_texture;
uniform float u_brightness;  // -1 to 1
uniform float u_contrast;    // 0 to 2 (1 = normal)
uniform float u_saturation;  // 0 to 2 (1 = normal)
uniform float u_exposure;    // -2 to 2 (0 = normal)

void main() {
  vec4 color = texture(u_texture, v_texCoord);
  vec3 rgb = color.rgb;

  // Apply exposure (before other adjustments)
  rgb *= pow(2.0, u_exposure);

  // Apply brightness
  rgb += u_brightness;

  // Apply contrast (around middle gray)
  rgb = (rgb - 0.5) * u_contrast + 0.5;

  // Apply saturation
  float lum = luminance(rgb);
  rgb = mix(vec3(lum), rgb, u_saturation);

  // Clamp to valid range
  rgb = clamp(rgb, 0.0, 1.0);

  fragColor = vec4(rgb, color.a);
}
`;

const definition: EffectDefinition = {
  name: 'colorAdjust',
  displayName: 'Color Adjustment',
  category: 'color',
  inputCount: 1,
  parameters: [
    {
      name: 'brightness',
      displayName: 'Brightness',
      type: 'float',
      default: 0,
      min: -1,
      max: 1,
      step: 0.01,
    },
    {
      name: 'contrast',
      displayName: 'Contrast',
      type: 'float',
      default: 1,
      min: 0,
      max: 2,
      step: 0.01,
    },
    {
      name: 'saturation',
      displayName: 'Saturation',
      type: 'float',
      default: 1,
      min: 0,
      max: 2,
      step: 0.01,
    },
    {
      name: 'exposure',
      displayName: 'Exposure',
      type: 'float',
      default: 0,
      min: -2,
      max: 2,
      step: 0.01,
    },
  ],
  fragmentShader: FRAGMENT_SHADER,
};

export class ColorAdjustEffect extends Effect {
  constructor() {
    super(definition);
  }
}

// Register the effect
effectRegistry.register(definition, ColorAdjustEffect as never);
