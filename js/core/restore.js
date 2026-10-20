// 축소 복원 — PC dot_factory.py restore --alignment-guided 를 옮겼습니다(df_alignment · df_restore).
// 큰 그림에서 몸 중심과 발 위치를 잡아 72×64 칸으로 나누고, 칸마다 원본에 실제로 있는 대표색 하나를 고릅니다.

import { findBackground, makeBackgroundTransparent, fillTransparent } from './background.js';
import { thumbnail } from './resample.js';
import { median, linspace, roundHalfEven, compareRgb } from './numeric.js';

export const DEFAULTS = Object.freeze({
  canvasW: 72, canvasH: 64, centerX: 36, footY: 60, targetHeight: 56,
  transparent: true, protectDark: false, darkLuma: 60, darkRatio: 0.16,
});

/** 8방향으로 이어진 덩어리를 찾아 넓이가 큰 순으로 돌려줍니다. */
function components(mask, w, h) {
  const seen = new Uint8Array(mask.length);
  const found = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const points = [];
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    while (stack.length) {
      const p = stack.pop();
      points.push(p);
      const x = p % w, y = (p - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
    }
    found.push({ area: points.length, bbox: [x0, y0, x1 + 1, y1 + 1], points });
  }
  return found.sort((a, b) => b.area - a.area);
}

/** 가까운 실제 색끼리 묶고, 묶음마다 실제 색 하나를 대표로 고릅니다(거리 24). */
function clusterColors(pixels, distance = 24) {
  const counts = new Map();
  for (const [r, g, b] of pixels) {
    const key = (r << 16) | (g << 8) | b;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const unique = [...counts.keys()].sort((a, b) => a - b).map(k => ({ rgb: [k >> 16, (k >> 8) & 255, k & 255], count: counts.get(k) }));
  const order = unique.map((_, i) => i).sort((i, j) => unique[j].count - unique[i].count || compareRgb(unique[i].rgb, unique[j].rgb));
  const assigned = new Uint8Array(unique.length);
  const clusters = [];
  const limit = distance * distance;
  for (const seed of order) {
    if (assigned[seed]) continue;
    const s = unique[seed].rgb;
    const members = [];
    for (let i = 0; i < unique.length; i++) {
      if (assigned[i]) continue;
      const c = unique[i].rgb;
      const d2 = (c[0] - s[0]) ** 2 + (c[1] - s[1]) ** 2 + (c[2] - s[2]) ** 2;
      if (d2 <= limit) members.push(i);
    }
    let total = 0;
    const center = [0, 0, 0];
    for (const i of members) {
      assigned[i] = 1;
      total += unique[i].count;
      for (let c = 0; c < 3; c++) center[c] += unique[i].rgb[c] * unique[i].count;
    }
    for (let c = 0; c < 3; c++) center[c] /= total;
    let best = members[0], bestKey = null;
    for (const i of members) {
      const c = unique[i].rgb;
      const key = [(c[0] - center[0]) ** 2 + (c[1] - center[1]) ** 2 + (c[2] - center[2]) ** 2, -unique[i].count];
      if (bestKey === null || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] ||
          (key[1] === bestKey[1] && compareRgb(c, unique[best].rgb) < 0)))) { best = i; bestKey = key; }
    }
    clusters.push({ color: unique[best].rgb, count: total });
  }
  return clusters;
}

function representativeColor(pixels, protectDetail, darkLuma, detailRatio) {
  const clusters = clusterColors(pixels);
  let dominant = clusters[0];
  for (const c of clusters) {
    if (c.count > dominant.count || (c.count === dominant.count && compareRgb(c.color, dominant.color) < 0)) dominant = c;
  }
  if (!protectDetail) return dominant.color;
  const total = pixels.length;
  let pick = null;
  for (const c of clusters) {
    if (c === dominant || c.count / total < detailRatio) continue;
    const dist = Math.hypot(c.color[0] - dominant.color[0], c.color[1] - dominant.color[1], c.color[2] - dominant.color[2]);
    const luma = 0.299 * c.color[0] + 0.587 * c.color[1] + 0.114 * c.color[2];
    if (luma < darkLuma || dist >= 56) {
      const key = [dist, c.count, c.color];
      if (!pick || key[0] > pick.key[0] || (key[0] === pick.key[0] && (key[1] > pick.key[1] ||
          (key[1] === pick.key[1] && compareRgb(key[2], pick.key[2]) > 0)))) pick = { key, color: c.color };
    }
  }
  return pick ? pick.color : dominant.color;
}

/** 칸 경계마다 가운데 1/3 영역의 배경 아닌 픽셀로 대표색을 고릅니다. 35% 미만이면 투명 칸입니다. */
export function sampleGrid(img, xBounds, yBounds, options = {}) {
  const { protectDark = false, darkLuma = 60, darkRatio = 0.16, background = findBackground(img).mask } = options;
  const { width: W, height: H, data } = img;
  const cellsX = xBounds.length - 1, cellsY = yBounds.length - 1;
  const out = new Uint8ClampedArray(cellsX * cellsY * 4);
  for (let cy = 0; cy < cellsY; cy++) {
    const fy0 = yBounds[cy], fy1 = yBounds[cy + 1], ch = fy1 - fy0;
    const y0 = Math.max(0, Math.floor(fy0 + ch / 3)), y1 = Math.min(H, Math.ceil(fy1 - ch / 3));
    if (y0 >= y1) continue;
    for (let cx = 0; cx < cellsX; cx++) {
      const fx0 = xBounds[cx], fx1 = xBounds[cx + 1], cw = fx1 - fx0;
      const x0 = Math.max(0, Math.floor(fx0 + cw / 3)), x1 = Math.min(W, Math.ceil(fx1 - cw / 3));
      if (x0 >= x1) continue;
      const valid = [];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = y * W + x;
          if (!background[p]) valid.push([data[p * 4], data[p * 4 + 1], data[p * 4 + 2]]);
        }
      }
      const total = (y1 - y0) * (x1 - x0);
      if (valid.length / total < 0.35) continue;
      const color = representativeColor(valid, protectDark, darkLuma, darkRatio);
      const o = (cy * cellsX + cx) * 4;
      out[o] = color[0]; out[o + 1] = color[1]; out[o + 2] = color[2]; out[o + 3] = 255;
    }
  }
  return { width: cellsX, height: cellsY, data: out };
}

/** 몸 중심 · 발 위치 · 키를 재서 원본에서 잘라 낼 범위를 정합니다(df_alignment.analyze). */
export function analyze(img, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (o.canvasW <= 0 || o.canvasH <= 0 || o.targetHeight <= 0) throw new Error('그림판 크기와 목표 키는 0보다 커야 합니다');
  if (!(o.centerX >= 0 && o.centerX < o.canvasW) || !(o.footY >= 0 && o.footY < o.canvasH)) {
    throw new Error('몸 중심과 발 위치는 그림판 안이어야 합니다');
  }
  const thumb = thumbnail(img, 720, 720);
  const { image: cut, background } = makeBackgroundTransparent(thumb);
  const tw = cut.width, th = cut.height;
  const solid = new Uint8Array(tw * th);
  for (let p = 0; p < solid.length; p++) solid[p] = cut.data[p * 4 + 3] > 0 ? 1 : 0;
  const parts = components(solid, tw, th);
  if (!parts.length) throw new Error('배경 말고는 캐릭터를 찾지 못했습니다');

  const main = parts[0];
  const mainMask = new Uint8Array(tw * th);
  for (const p of main.points) mainMask[p] = 1;
  const [x0, y0, x1, y1] = main.bbox;
  const charHeight = y1 - y0;
  const bandTop = y0 + roundHalfEven(charHeight * 0.34);
  const bandBottom = y0 + roundHalfEven(charHeight * 0.82);
  const rowCenters = [];
  for (let y = Math.max(y0, bandTop); y < Math.min(y1, bandBottom); y++) {
    let xs = [];
    for (let x = 0; x < tw; x++) if (mainMask[y * tw + x]) xs.push(x);
    if (!xs.length) continue;
    const trim = Math.max(0, Math.trunc(xs.length * 0.15));
    if (trim && xs.length > trim * 2) xs = xs.slice(trim, xs.length - trim);
    rowCenters.push(median(xs));
  }
  const axisThumb = rowCenters.length ? median(rowCenters) : (x0 + x1 - 1) / 2;
  const footThumb = y1 - 1;

  const perThumb = img.height / th;
  const bodyAxis = axisThumb * perThumb;
  const foot = footThumb * perThumb;
  const perCell = (charHeight * perThumb) / o.targetHeight;
  const left = bodyAxis - o.centerX * perCell;
  const top = foot - o.footY * perCell;
  const crop = [left, top, left + o.canvasW * perCell, top + o.canvasH * perCell];

  const minimumArea = Math.max(3, Math.trunc(main.area * 0.0005));
  const excluded = parts.slice(1).filter(c => c.area >= minimumArea).map(c => c.bbox.map(v => v * perThumb));
  return {
    canvas: [o.canvasW, o.canvasH], crop, bodyAxis, foot, perCell, background,
    mainBox: main.bbox.map(v => v * perThumb), excluded, thumb: { width: tw, height: th, perThumb },
  };
}

/** 큰 그림을 도트 칸 그림으로 줄입니다. 결과와 잰 기준을 함께 돌려줍니다. */
export function restore(img, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const details = analyze(img, o);
  const [w, h] = details.canvas;
  const xb = linspace(details.crop[0], details.crop[2], w + 1);
  const yb = linspace(details.crop[1], details.crop[3], h + 1);
  let out = sampleGrid(img, xb, yb, o);
  if (!o.transparent) out = fillTransparent(out, details.background);
  return { image: out, details };
}
