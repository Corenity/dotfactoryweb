// Oklab 인지 색 공간 기반 유사 색상 묶기 모듈
// 인간 시각 특성에 맞추어 도트 그림의 유사한 색상들을 최빈색(가장 많이 쓰인 색)으로 통일합니다.

import { clone, edgeBackground } from './paint.js';

export const KEY = [3, 192, 55, 255];

/** sRGB 채널값(0~255)을 선형 sRGB(0~1)로 변환합니다. */
export function srgbToLinear(c) {
  const v = c / 255;
  return v >= 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
}

/** sRGB (r, g, b)를 Oklab (L, a, b) 공간으로 변환합니다. */
export function rgbToOklab(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

/** Oklab 공간에서 두 색 사이의 인지 거리(유클리드 거리)를 계산합니다. */
export function oklabDistance(lab1, lab2) {
  const dl = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** 초록 배경(기본 초록 3,192,55 및 외곽 지피티 초록 등)인지 판별합니다. */
function isGreenBackground(r, g, b, edgeColor) {
  if (r === KEY[0] && g === KEY[1] && b === KEY[2]) return true;
  if (edgeColor && r === edgeColor[0] && g === edgeColor[1] && b === edgeColor[2]) {
    if (edgeColor[1] > 150 && edgeColor[0] < 50 && edgeColor[2] < 100) return true;
  }
  return false;
}

/** 투명 칸 및 초록 배경을 제외한 고유 색상 수를 계산합니다. */
export function countUniqueColors(img) {
  const { data } = img;
  const edge = edgeBackground(img);
  const colors = new Set();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (isGreenBackground(r, g, b, edge)) continue;
    colors.add(`${r},${g},${b},${a}`);
  }
  return colors.size;
}

/**
 * 축소 결과 이미지에서 비슷한 계열의 색상들을 가장 많이 쓰인 대표색으로 합칩니다.
 * 투명 칸과 초록 배경(KEY 및 가장자리 초록)은 건드리지 않습니다.
 *
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} img
 * @param {{ threshold?: number }} [options] threshold: Oklab 거리 기준 (기본 0.05)
 * @returns {{ image: { width: number, height: number, data: Uint8ClampedArray }, beforeCount: number, afterCount: number, changedPixels: number }}
 */
export function mergeSimilarColors(img, options = {}) {
  const threshold = options.threshold ?? 0.05;
  const { data } = img;
  const edge = edgeBackground(img);

  // 1. 유효 픽셀의 고유 색상 및 빈도수 집계
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (isGreenBackground(r, g, b, edge)) continue;
    const key = `${r},${g},${b},${a}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const beforeCount = counts.size;
  if (beforeCount <= 1) {
    return { image: clone(img), beforeCount, afterCount: beforeCount, changedPixels: 0 };
  }

  // 2. 빈도수 내림차순 정렬 및 Oklab 변환
  const colorList = [];
  for (const [key, count] of counts) {
    const [r, g, b, a] = key.split(',').map(Number);
    colorList.push({
      key,
      r, g, b, a,
      count,
      lab: rgbToOklab(r, g, b),
    });
  }
  colorList.sort((c1, c2) => c2.count - c1.count);

  // 3. 리더 기반 군집화 (가장 많이 쓰인 색 우선 매핑)
  const colorMap = new Map();
  for (let i = 0; i < colorList.length; i++) {
    const leader = colorList[i];
    if (colorMap.has(leader.key)) continue;
    // 리더 자신은 자기 색으로 매핑
    colorMap.set(leader.key, [leader.r, leader.g, leader.b, leader.a]);

    // 아직 매핑되지 않은 후보들 중 거리 threshold 이하인 색을 리더 색으로 흡수
    for (let j = i + 1; j < colorList.length; j++) {
      const candidate = colorList[j];
      if (colorMap.has(candidate.key)) continue;
      const dist = oklabDistance(leader.lab, candidate.lab);
      if (dist <= threshold) {
        colorMap.set(candidate.key, [leader.r, leader.g, leader.b, leader.a]);
      }
    }
  }

  // 4. 새 이미지 생성 및 픽셀 교체
  const out = clone(img);
  let changedPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (isGreenBackground(r, g, b, edge)) continue;

    const key = `${r},${g},${b},${a}`;
    const target = colorMap.get(key);
    if (target && (target[0] !== r || target[1] !== g || target[2] !== b || target[3] !== a)) {
      out.data[i] = target[0];
      out.data[i + 1] = target[1];
      out.data[i + 2] = target[2];
      out.data[i + 3] = target[3];
      changedPixels++;
    }
  }

  const uniqueAfter = new Set([...colorMap.values()].map(c => c.join(','))).size;

  return {
    image: out,
    beforeCount,
    afterCount: uniqueAfter,
    changedPixels,
  };
}
