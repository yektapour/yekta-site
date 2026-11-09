/* Yekta Light — color math (sRGB / linear / HSV / OKLab) */
(function (L) {
  'use strict';
  const C = {};
  C.clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  C.toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  C.toSrgb = (c) => {
    if (c <= 0) return 0;
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  C.lin3 = (c) => [C.toLin(c[0]), C.toLin(c[1]), C.toLin(c[2])];

  C.rgbToHsv = (r, g, b) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d > 1e-9) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max <= 0 ? 0 : d / max, max];
  };
  C.hsvToRgb = (h, s, v) => {
    h = ((h % 360) + 360) % 360;
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    let r, g, b;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [r + m, g + m, b + m];
  };

  const hx = (v) => {
    const s = Math.round(C.clamp01(v) * 255).toString(16);
    return s.length < 2 ? '0' + s : s;
  };
  C.toHex = (c) => '#' + hx(c[0]) + hx(c[1]) + hx(c[2]);
  C.fromHex = (str) => {
    if (!str) return null;
    let s = String(str).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((ch) => ch + ch).join('');
    if (!/^[0-9a-f]{6}$/i.test(s)) return null;
    return [0, 2, 4].map((i) => parseInt(s.substr(i, 2), 16) / 255);
  };
  C.to255 = (c) => c.map((v) => Math.round(C.clamp01(v) * 255));

  // OKLab (input/output linear sRGB)
  C.linToOklab = (c) => {
    const l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
    const m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
    const s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  C.oklabToLin = (o) => {
    const l = Math.pow(o[0] + 0.3963377774 * o[1] + 0.2158037573 * o[2], 3);
    const m = Math.pow(o[0] - 0.1055613458 * o[1] - 0.0638541728 * o[2], 3);
    const s = Math.pow(o[0] - 0.0894841775 * o[1] - 1.291485548 * o[2], 3);
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  };
  C.srgbToOklab = (c) => C.linToOklab(C.lin3(c));
  C.oklabToSrgb = (o) => C.oklabToLin(o).map((v) => C.clamp01(C.toSrgb(v)));
  C.luma = (c) => {
    const l = C.lin3(c);
    return C.toSrgb(0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]);
  };

  L.color = C;
})((window.Yekta = window.Yekta || {}));
