// Color Adjustment Effect
// Handles brightness, contrast, saturation, and exposure

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
