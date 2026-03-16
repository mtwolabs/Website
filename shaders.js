/**
 * GLSL shader sources — monochrome cloudscape with mouse-driven wind.
 */

export const oceanVertexSource = `
  attribute vec2 aPosition;
  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

export const oceanFragmentSource = `
  precision highp float;

  uniform vec2 uResolution;
  uniform float uTime;
  uniform vec2 uMouse;
  uniform float uClouds;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Better hash — avoids sin banding at large coordinates
  float ihash(vec2 p) {
    vec3 q = fract(vec3(p.x, p.y, p.x) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(
      mix(hash(i), hash(i + vec2(1, 0)), f.x),
      mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 7; i++) {
      v += a * noise(p);
      p = m * p * 2.0;
      a *= 0.5;
    }
    return v;
  }

  // Domain warping for organic swirling motion
  float warpedFbm(vec2 p, float t, vec2 wind) {
    // First warp layer
    vec2 q = vec2(
      fbm(p + vec2(0.0, 0.0) + t * 0.12 + wind * 0.3),
      fbm(p + vec2(5.2, 1.3) - t * 0.1 + wind * 0.2)
    );
    // Second warp layer — influenced by mouse wind
    vec2 r = vec2(
      fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * 0.06 + wind * 0.5),
      fbm(p + 4.0 * q + vec2(8.3, 2.8) - t * 0.08 + wind * 0.4)
    );
    return fbm(p + 3.5 * r + wind * 0.15);
  }

  // Stars — checks 3x3 neighborhood to avoid cell-edge clipping
  float stars(vec2 uv, float density, float threshold, vec2 mouse) {
    vec2 cell = floor(uv * density);
    float result = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbor = cell + vec2(x, y);
        float r = ihash(neighbor);
        if (r < threshold) continue;
        float r2 = ihash(neighbor + 173.0);
        float r3 = ihash(neighbor + 337.0);
        vec2 starPos = neighbor + vec2(r2, r3);
        vec2 starWorld = starPos / density;
        float d = length(uv * density - starPos);
        float brightness = (r - threshold) / (1.0 - threshold);
        float phase = r * 6.2831;
        float shimmer = 0.5
          + 0.22 * sin(uTime * (0.15 + r2 * 0.35) + phase)
          + 0.18 * sin(uTime * (0.4 + r3 * 0.6) + phase * 4.1)
          + 0.10 * sin(uTime * (0.8 + r * 1.2) + phase * 9.3);

        // Mouse proximity — stars flare when cursor is near
        float mouseDist = length(starWorld - mouse);
        float flare = exp(-mouseDist * mouseDist * 40.0);
        float core = smoothstep(0.22 + flare * 0.3, 0.0, d);
        float glow = exp(-d * d * (14.0 - flare * 10.0)) * (0.35 + flare * 0.6) * shimmer;
        brightness *= 1.0 + flare * 2.0;

        result += (core + glow) * brightness * shimmer;
      }
    }
    return result;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    float aspect = uResolution.x / uResolution.y;
    vec2 uvA = vec2(uv.x * aspect, uv.y);
    float t = uTime;

    vec2 mouseUV = vec2(uMouse.x * aspect, uMouse.y);
    float totalCloud = 0.0;

    if (uClouds > 0.5) {
      // --- Cloud base layer ---
      float baseMask = smoothstep(0.75, 0.12, uv.y);
      baseMask = pow(baseMask, 1.2);

      // Wind from mouse
      vec2 toMouse = mouseUV - uvA;
      float mouseDist = length(toMouse);
      vec2 wind = toMouse * exp(-mouseDist * 1.5) * 1.2 * baseMask;

      // Primary warped noise with wind influence
      float cloud1 = warpedFbm(uvA * 1.8, t * 0.3, wind);
      float cloud2 = fbm(uvA * 4.0 + vec2(t * 0.06, -t * 0.04) + wind * 0.5 + 20.0);
      float cloud3 = fbm(uvA * 8.0 + vec2(-t * 0.03, t * 0.05) + wind * 0.25 + 40.0);

      float clouds = cloud1 * 0.55 + cloud2 * 0.28 + cloud3 * 0.17;

      float ridges = pow(clouds, 2.2) * 0.2;
      float valleys = (1.0 - pow(1.0 - clouds, 3.0)) * 0.05;
      float cloudBrightness = (ridges + valleys) * baseMask;

      float edge = abs(fract(clouds * 5.0) - 0.5) * 2.0;
      edge = pow(edge, 10.0) * 0.05 * baseMask;

      totalCloud = cloudBrightness + edge;
    }

    vec3 col = vec3(0.01);
    col += vec3(totalCloud);

    // Stars
    float starOcclusion = 1.0 - totalCloud * 5.0;
    starOcclusion = max(starOcclusion, 0.0);

    float s1 = stars(uvA, 300.0, 0.998, mouseUV);
    float s2 = stars(uvA + 77.0, 200.0, 0.997, mouseUV) * 0.6;
    float s3 = stars(uvA + 155.0, 120.0, 0.996, mouseUV) * 0.35;

    col += vec3(0.9, 0.92, 0.95) * (s1 + s2 + s3) * 1.5 * starOcclusion;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export const grainVertexSource = `
  attribute vec2 aPosition;
  varying vec2 vUV;
  void main() {
    vUV = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

export const grainFragmentSource = `
  precision highp float;

  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUV;

  float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec4 color = texture2D(uTexture, vUV);

    // Static film grain — fixed pattern, no animation
    vec2 seed = gl_FragCoord.xy;
    float grain = rand(seed) + rand(seed + 1.7);
    grain = grain * 0.5 - 0.5;
    // Stronger grain on brighter areas, subtle on dark sky
    float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    float grainStrength = mix(0.06, 0.25, smoothstep(0.0, 0.15, luminance));
    color.rgb += grain * grainStrength;

    // Vignette
    vec2 q = vUV - 0.5;
    color.rgb *= 1.0 - dot(q, q) * 0.35;

    gl_FragColor = color;
  }
`;
