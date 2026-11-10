// Yekta Light: GPU version of the painter light model (see light.js), injected into a standard
// material so skinning, normal maps and shadow maps come from three.js.
import { Vector3, Color } from './vendor/three.module.js';

export function makeUniforms() {
  return {
    uL: { value: new Vector3(0, 0, 1) }, uLc: { value: new Color() },
    uL2: { value: new Vector3(0, 0, 1) }, uLc2: { value: new Color(0, 0, 0) },
    uUp: { value: new Vector3(0, 1, 0) },
    uWrap: { value: 0.2 }, uBands: { value: 0 }, uSoft: { value: 0.2 },
    uAmb: { value: new Color() }, uAmbInt: { value: 0.3 }, uBnc: { value: new Color() }, uBncInt: { value: 0.2 },
    uRimC: { value: new Color() }, uRimInt: { value: 0 }, uRimExp: { value: 3 },
    uTint: { value: new Color(1, 1, 1) }, uTintAmt: { value: 0 },
    uEnvC: { value: new Color() }, uEnvCustom: { value: 0 },
    uBase: { value: new Color() }, uSpec: { value: new Color(1, 1, 1) }, uSpecInt: { value: 0.3 }, uExp: { value: 40 }, uNorm: { value: 1 },
    uMetal: { value: 0 }, uEnvK: { value: 0 }, uSss: { value: 0 }, uSssC: { value: new Color() },
    uTexMode: { value: 1 }, uTexTint: { value: new Color(1, 1, 1) }, uSkinC: { value: new Vector3(0.5, 0.3, 0.2) },
    uVMode: { value: 0 }, uNotan: { value: 0.5 }, uIso: { value: -1 }, uShadowOn: { value: 1 },
  };
}

const PARS = /* glsl */`
uniform vec3 uSkinC;
uniform vec3 uL, uLc, uL2, uLc2, uUp, uAmb, uBnc, uRimC, uTint, uEnvC, uBase, uSpec, uSssC, uTexTint;
uniform float uWrap, uBands, uSoft, uAmbInt, uBncInt, uRimInt, uRimExp, uTintAmt, uEnvCustom, uSpecInt, uExp, uNorm, uMetal, uEnvK, uSss, uTexMode, uVMode, uNotan, uIso, uShadowOn;
float ylBand(float d, float k, float soft) {
  float x = d * k, i = floor(x), f = x - i, e = soft * 0.5;
  float s = e < 1e-4 ? step(0.5, f) : smoothstep(0.5 - e, 0.5 + e, f);
  return min(1.0, (i + s) / k);
}
float ylEnc(float x) {
  const float K = 0.82;
  if (x > K) x = K + (1.0 - K) * (1.0 - exp(-(x - K) / (1.0 - K)));
  return x <= 0.0031308 ? x * 12.92 : 1.055 * pow(max(x, 0.0), 1.0 / 2.4) - 0.055;
}
`;

const MAIN = /* glsl */`
  vec3 N = normalize(normal);
  vec3 V = normalize(vViewPosition);
  float sh = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow dls = directionalLightShadows[0];
    sh = mix(1.0, getShadow(directionalShadowMap[0], dls.shadowMapSize, dls.shadowBias, dls.shadowRadius, vDirectionalShadowCoord[0]), uShadowOn);
  #endif
  // the base color re-tints only the skin of the scan (clothes, hair and eyes keep their own color)
  vec3 tx = diffuseColor.rgb;
  float txs = tx.r + tx.g + tx.b;
  float skin = (1.0 - smoothstep(0.05, 0.17, length(tx / max(txs, 1e-4) - uSkinC))) * smoothstep(0.03, 0.12, txs);
  vec3 texC = tx * mix(vec3(1.0), uTexTint, skin);
  vec3 base = mix(uBase, texC, uTexMode);
  float rough = mix(0.5, roughnessFactor, uTexMode);
  float specI = uSpecInt * mix(1.0, clamp(1.25 - rough, 0.15, 1.0) * 0.75, uTexMode);
  vec3 alb = base * (1.0 - uMetal);
  vec3 spc = mix(uSpec, base, uMetal);
  bool toon = uBands > 1.5;
  float ndl = dot(N, uL);
  float d = clamp((ndl + uWrap) / (1.0 + uWrap), 0.0, 1.0);
  if (toon) d = ylBand(d, uBands, uSoft);
  d *= sh;
  vec3 H = normalize(uL + V);
  float nh = dot(N, H), s = 0.0;
  if (nh > 0.0 && ndl > -0.1) {
    s = pow(nh, uExp);
    if (toon) { float e = max(0.01, uSoft * 0.25); s = smoothstep(0.5 - e, 0.5 + e, s) * 1.6; } else s *= uNorm;
    s *= specI * sh * smoothstep(-0.1, 0.12, ndl);
  }
  float sss = 0.0;
  if (uSss > 0.0) { float x = (ndl + 0.05) / 0.32; sss = exp(-x * x) * uSss * 0.6 * (0.35 + 0.65 * sh); if (toon) sss *= 0.5; }
  float nd2 = dot(N, uL2), d2 = clamp((nd2 + 0.1) / 1.1, 0.0, 1.0), s2 = 0.0;
  if (toon) d2 = ylBand(d2, uBands, uSoft);
  vec3 H2 = normalize(uL2 + V); float nh2 = dot(N, H2);
  if (nh2 > 0.0 && nd2 > 0.0 && !toon) s2 = pow(nh2, uExp) * uNorm * specI;
  float ny = dot(N, uUp);
  float ao = 1.0;
  #ifdef USE_AOMAP
    ao = (texture2D(aoMap, vAoMapUv).r - 1.0) * aoMapIntensity + 1.0;
  #endif
  float sky = (0.55 + 0.45 * ny) * ao * uAmbInt;
  float bb = 0.5 - 0.5 * ny, bounce = bb * bb * ao * uBncInt;
  float nv = max(dot(N, V), 0.0);
  float rim = 0.0;
  if (uRimInt > 0.0) { rim = pow(1.0 - nv, uRimExp); if (toon) rim = smoothstep(0.42 - uSoft * 0.2, 0.48 + uSoft * 0.2, rim); rim *= uRimInt * ao; }
  float ek = 0.0;
  if (uEnvK > 0.0) { float ry = 2.0 * nv * ny, fr = 0.35 + 0.65 * pow(1.0 - nv, 4.0); ek = uEnvK * ao * (0.25 + 0.75 * smoothstep(-0.3, 0.6, ry)) * (dot(alb, vec3(1.0)) > 0.0 ? fr : 1.0); }
  vec3 env = mix(uAmb * uAmbInt * 1.4, uEnvC, uEnvCustom);
  vec3 col = spc * ek * (env + uLc * 0.22)
    + alb * (uLc * d + uLc2 * d2) + base * uSssC * uLc * sss
    + base * (uAmb * sky + uBnc * bounce)
    + spc * (uLc * s + uLc2 * s2) + uRimC * rim * (0.35 + 0.65 * base);
  float tw = uTintAmt * (1.0 - d);
  if (tw > 0.0) { float Y = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = col * (1.0 - tw) + Y * uTint * tw; }
  vec3 outgoingLight = col;
`;

const FINISH = /* glsl */`
  {
    vec3 c = gl_FragColor.rgb;
    float Yl = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 e = vec3(ylEnc(c.r), ylEnc(c.g), ylEnc(c.b));
    float Y = ylEnc(Yl);
    if (uVMode > 0.5) {
      float v = Y;
      if (uVMode < 1.5) v = Y;
      else if (uVMode < 2.5) v = Y >= uNotan ? 0.92 : 0.1;
      else if (uVMode < 3.5) v = Y < 0.36 ? 0.1 : (Y < 0.68 ? 0.48 : 0.9);
      else v = 0.08 + min(4.0, floor(Y * 5.0)) * 0.215;
      e = vec3(v);
    }
    if (uIso >= 0.0 && abs(Y - uIso) < 0.03) e = mix(e, vec3(1.0, 0.71, 0.29), 0.75);
    gl_FragColor.rgb = e;
  }
`;

// patch a MeshStandardMaterial: our lighting replaces the PBR lighting, our encoding replaces the output transform
export function patchMaterial(mat, uniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace('#include <lights_fragment_begin>', MAIN)
      .replace('#include <lights_fragment_maps>', '')
      .replace('#include <lights_fragment_end>', '')
      .replace('#include <aomap_fragment>', '')
      .replace(/vec3 outgoingLight = totalDiffuse[^;]*;/, '')
      .replace('#include <colorspace_fragment>', FINISH);
  };
  mat.customProgramCacheKey = () => 'yekta-light-1';
  return mat;
}

