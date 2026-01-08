// Gaussian Blur Effect (Single Pass - Separable)
// For optimal performance, apply twice: once horizontal, once vertical

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

  // Sample kernel
  int samples = int(ceil(u_radius)) * 2 + 1;
  int halfSamples = samples / 2;

  for (int i = -halfSamples; i <= halfSamples; i++) {
    float offset = float(i);
    float weight = gaussian(offset, sigma);

    vec2 samplePos = v_texCoord + u_direction * texelSize * offset;
    color += texture(u_texture, samplePos) * weight;
    totalWeight += weight;
  }

  fragColor = color / totalWeight;
}
