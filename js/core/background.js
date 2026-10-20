// 배경 찾기 — PC df_grid.estimate_background · get_background_mask, df_restore 의 배경 함수를 옮겼습니다.
// 그림은 { width, height, data: Uint8ClampedArray(RGBA) } 로 다룹니다. 배경 판정에는 RGB 만 씁니다.

import { median, quantile, roundHalfEven as rint } from './numeric.js';

const MAX_DISTANCE = Math.ceil(Math.sqrt(3 * 255 * 255));

function edgePixels(img) {
  const { width: w, height: h, data } = img;
  const out = [];
  const push = (x, y) => { const i = (y * w + x) * 4; out.push([data[i], data[i + 1], data[i + 2]]); };
  // numpy 의 concat(첫 줄, 끝 줄, 첫 열, 끝 열) 과 같은 순서 · 같은 중복(모서리)입니다.
  for (let x = 0; x < w; x++) push(x, 0);
  for (let x = 0; x < w; x++) push(x, h - 1);
  for (let y = 0; y < h; y++) push(0, y);
  for (let y = 0; y < h; y++) push(w - 1, y);
  return out;
}

function distancesFrom(img, center) {
  const { data } = img;
  const n = img.width * img.height;
  const out = new Float64Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const dr = data[i] - center[0], dg = data[i + 1] - center[1], db = data[i + 2] - center[2];
    out[p] = Math.sqrt(dr * dr + dg * dg + db * db);
  }
  return out;
}

/** 가장자리 색 분포로 배경 중심색과 두 거리 경계(core · fringe)를 잽니다. */
export function estimateBackground(img) {
  const edge = edgePixels(img);
  const center = [0, 1, 2].map(c => median(edge.map(p => p[c])));
  const distances = distancesFrom(img, center);
  const edgeDistances = edge.map(p => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]));

  const histogram = new Float64Array(MAX_DISTANCE + 1);
  for (const d of distances) {
    histogram[Math.min(MAX_DISTANCE, Math.max(0, rint(d)))] += 1;
  }
  let total = 0, totalSum = 0;
  for (let i = 0; i < histogram.length; i++) { total += histogram[i]; totalSum += histogram[i] * i; }
  let bgWeight = 0, bgSum = 0, best = -1, otsu = 0, anyValid = false;
  for (let i = 0; i < histogram.length; i++) {
    bgWeight += histogram[i];
    bgSum += histogram[i] * i;
    const fgWeight = total - bgWeight;
    if (bgWeight > 0 && fgWeight > 0) {
      const v = bgWeight * fgWeight * (bgSum / bgWeight - (totalSum - bgSum) / fgWeight) ** 2;
      if (!anyValid || v > best) { best = v; otsu = i; anyValid = true; }
    }
  }
  if (!anyValid) otsu = 0;

  const edgeLimit = Math.ceil(quantile(edgeDistances, 0.995));
  if (edgeLimit === 0) return { center, core: 0.5, fringe: 0.5 };
  const fringeLimit = Math.max(edgeLimit, otsu);
  let coreLimit = edgeLimit;
  if (fringeLimit > edgeLimit) {
    // np.convolve(hist, ones(9), 'same') 의 가운데 맞춤 합입니다.
    let bestValue = Infinity, bestAt = 0;
    for (let i = edgeLimit; i <= fringeLimit; i++) {
      let sum = 0;
      for (let k = i - 4; k <= i + 4; k++) if (k >= 0 && k < histogram.length) sum += histogram[k];
      if (sum < bestValue) { bestValue = sum; bestAt = i - edgeLimit; }
    }
    coreLimit = edgeLimit + bestAt;
  }
  return { center, core: coreLimit + 0.5, fringe: fringeLimit + 0.5 };
}

/**
 * 배경으로 볼 칸을 1 로 둔 배열(core 이거나, 네 모서리에서 이어진 fringe)과 배경색을 돌려줍니다.
 * @returns {{ mask: Uint8Array, color: number[] }}
 */
export function findBackground(img) {
  const { width: w, height: h } = img;
  const { center, core, fringe } = estimateBackground(img);
  const distances = distancesFrom(img, center);
  const n = w * h;
  const mask = new Uint8Array(n);
  const candidate = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (distances[p] <= core) mask[p] = 1;
    if (distances[p] <= fringe) candidate[p] = 1;
  }
  // PIL ImageDraw.floodfill 처럼 네 모서리에서 4방향으로 채웁니다.
  const seen = new Uint8Array(n);
  const stack = [];
  for (const p of [0, w - 1, (h - 1) * w, (h - 1) * w + w - 1]) {
    if (candidate[p] && !seen[p]) { seen[p] = 1; stack.push(p); }
    while (stack.length) {
      const q = stack.pop();
      mask[q] = 1;
      const x = q % w, y = (q - x) / w;
      if (x > 0 && candidate[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack.push(q - 1); }
      if (x < w - 1 && candidate[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack.push(q + 1); }
      if (y > 0 && candidate[q - w] && !seen[q - w]) { seen[q - w] = 1; stack.push(q - w); }
      if (y < h - 1 && candidate[q + w] && !seen[q + w]) { seen[q + w] = 1; stack.push(q + w); }
    }
  }
  return { mask, color: center.map(v => Math.min(255, Math.max(0, rint(v)))) };
}

/** 이어진 배경과 원래 투명한 칸을 투명하게 만든 새 그림과 배경색을 돌려줍니다. */
export function makeBackgroundTransparent(img) {
  const { mask, color } = findBackground(img);
  const data = new Uint8ClampedArray(img.data);
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    if (mask[p] || img.data[i + 3] === 0) { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0; }
  }
  return { image: { width: img.width, height: img.height, data }, background: color };
}

/** 투명 칸을 배경색 하나로 채운 새 그림을 돌려줍니다. */
export function fillTransparent(img, color) {
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) { data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; }
    data[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data };
}
