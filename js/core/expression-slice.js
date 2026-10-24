// site/js/core/expression-slice.js — 자르기 표정 모드(눈 · 입) 자동 조각 분할 순수 모듈
// 화면(DOM)을 쓰지 않는 순수 모듈로 Node 시험이 그대로 돌립니다.

import { extractSkinColors, isSameBareColor } from './auto-slice.js';

export const EXPRESSION_PIECES_META = Object.freeze([
  { sourceKind: 'expression', piece: 'eyes', label: 1, name: '눈' },
  { sourceKind: 'expression', piece: 'mouth', label: 2, name: '입' },
]);

export const LABEL_DROPPED = 0;
export const LABEL_EYES = 1;
export const LABEL_MOUTH = 2;

/**
 * 초록 배경 또는 완전 투명 칸인지 판정합니다.
 */
function isBackgroundKey(r, g, b, a) {
  if (a === 0) return true;
  // 표준 초록 (3, 192, 55) 및 지피티 변형 초록 (3, 203, 47) 등
  if (g >= 140 && r <= 60 && b <= 80) return true;
  if (Math.hypot(r - 3, g - 192, b - 55) <= 30) return true;
  return false;
}

/**
 * 맨몸/얼굴틀 바탕 살색 칸인지 판정합니다.
 * 눈 흰자위(순백색)와 어두운 선, 뚜렷한 색상(입술, 눈물, 땀 등)은 살색으로 오판하지 않습니다.
 */
function isBareSkinPixel(r, g, b, bareR, bareG, bareB, bareA, activeSkinColors, tolerance = 18) {
  // 1. 맨몸/얼굴틀 원본 픽셀과 같은 색이면 바탕(살색 또는 윤곽선 테두리)이므로 제거
  if (bareA > 0 && isSameBareColor(r, g, b, bareR, bareG, bareB, tolerance)) {
    return true;
  }

  // 2. 눈 흰자위(순백색)는 살색 제외 대상이 아님
  if (r >= 245 && g >= 245 && b >= 245) return false;

  // 3. 어두운 선(눈썹, 눈 테두리, 입술선)은 살색 아님
  const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
  if (brightness < 120) return false;

  // 4. 추출된 살색 팔레트와 거리 검사
  const tolSq = tolerance * tolerance;
  for (let i = 0; i < activeSkinColors.length; i++) {
    const sc = activeSkinColors[i];
    const dr = r - sc[0];
    const dg = g - sc[1];
    const db = b - sc[2];
    if (dr * dr + dg * dg + db * db <= tolSq) {
      return true;
    }
  }

  // 5. 붉은 입술/분홍 볼터치/푸른 눈물·땀 등 뚜렷한 표정 색상은 살색으로 지우지 않고 덩어리 분석에서 분류
  if (r - g >= 35 && r >= 160) {
    return false;
  }
  if (b > r + 20 && b > g) {
    return false;
  }

  // 6. 대머리 바탕 일반 살색 범위 (r>=200, g>=140, b>=115 부근)
  if (r >= 200 && g >= 140 && b >= 115 && Math.abs(r - g) <= 65 && Math.abs(g - b) <= 45) {
    return true;
  }

  return false;
}

/**
 * 그때 쓰는 얼굴틀 그림의 실제 칸(얼굴 영역 · 윤곽)에서 바운딩 영역을 계산합니다.
 * 고정 좌표를 쓰지 않고 실제 얼굴틀 그림의 불투명 칸을 기준으로 계산하여,
 * 얼굴틀 그림이 바뀌어도(머리 크기나 위치 변화) 눈 · 입 자리가 동적으로 맞춰집니다.
 */
export function getFaceBounds(bareInfo, width = 72, height = 64) {
  if (bareInfo?.faceBounds) {
    return bareInfo.faceBounds;
  }
  if (bareInfo?.facePixels && bareInfo.facePixels.length > 0) {
    let minX = width, maxX = -1, minY = height, maxY = -1;
    let sumX = 0, sumY = 0;
    for (const [x, y] of bareInfo.facePixels) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;
    }
    const count = bareInfo.facePixels.length;
    return {
      minX, maxX, minY, maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      cx: sumX / count,
      cy: sumY / count,
      count,
    };
  }
  if (bareInfo?.bareImage) {
    const { bareImage, barePartMap } = bareInfo;
    let minX = width, maxX = -1, minY = height, maxY = -1;
    let sumX = 0, sumY = 0;
    let count = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const s = idx * 4;
        if (bareImage.data[s + 3] > 0) {
          const part = barePartMap ? barePartMap[idx] : null;
          if (part === 'face' || (!part && y <= height * 0.65)) {
            count++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            sumX += x;
            sumY += y;
          }
        }
      }
    }
    if (count > 0) {
      return {
        minX, maxX, minY, maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        cx: sumX / count,
        cy: sumY / count,
        count,
      };
    }
  }

  // fallback 기본 바운딩
  const minX = 20, maxX = 51, minY = 6, maxY = 37;
  return {
    minX, maxX, minY, maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    count: 0,
  };
}

/**
 * 대머리 얼굴 그림에서 눈(눈·눈물·눈썹)과 입을 분할하고 코·볼·땀을 버립니다.
 */
export function sliceExpression({
  image,
  bareInfo = null,
  stripBare = true,
  tolerance = 18,
  faceEllipse = null,
  preservedAssignments = null,
  userModifiedMask = null,
  skinColors = null,
  skinTolerance = 18,
}) {
  const { width, height } = image;
  const d = image.data;
  const assignments = new Uint8Array(width * height);

  const shouldStrip = stripBare !== null ? !!stripBare : true;
  const bareImg = bareInfo?.bareImage;
  const fb = getFaceBounds(bareInfo, width, height);

  // 살색 목록 추출
  let activeSkinColors = skinColors;
  if (!activeSkinColors && bareInfo) {
    const effEllipse = faceEllipse || {
      cx: Math.round(fb.cx),
      cy: Math.round(fb.cy),
      rx: Math.round(fb.width * 0.4),
      ry: Math.round(fb.height * 0.3),
    };
    activeSkinColors = extractSkinColors(image, bareInfo, effEllipse);
  }
  if (!activeSkinColors) activeSkinColors = [];

  // 1단계: 유효 표시 픽셀(초록 배경 및 살색 제외) 마스크 생성
  const isForeground = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const s = idx * 4;
      const a = d[s + 3];
      if (a === 0) continue;

      const r = d[s], g = d[s + 1], b = d[s + 2];
      if (isBackgroundKey(r, g, b, a)) continue;

      if (shouldStrip) {
        let bareR = 0, bareG = 0, bareB = 0, bareA = 0;
        if (bareImg) {
          bareR = bareImg.data[s];
          bareG = bareImg.data[s + 1];
          bareB = bareImg.data[s + 2];
          bareA = bareImg.data[s + 3];
        }

        if (isBareSkinPixel(r, g, b, bareR, bareG, bareB, bareA, activeSkinColors, skinTolerance)) {
          continue;
        }
      }

      isForeground[idx] = 1;
    }
  }

  // 2단계: 8방향 연결 컴포넌트(Connected Components) 군집화
  const visited = new Uint8Array(width * height);
  const blobs = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!isForeground[idx] || visited[idx]) continue;

      const pixels = [];
      const queue = [idx];
      visited[idx] = 1;

      let minX = x, maxX = x, minY = y, maxY = y;
      let sumX = 0, sumY = 0;
      let sumR = 0, sumG = 0, sumB = 0;

      while (queue.length > 0) {
        const curIdx = queue.shift();
        const curX = curIdx % width;
        const curY = (curIdx / width) | 0;
        const s = curIdx * 4;
        const r = d[s], g = d[s + 1], b = d[s + 2];

        pixels.push(curIdx);
        sumX += curX;
        sumY += curY;
        sumR += r;
        sumG += g;
        sumB += b;

        if (curX < minX) minX = curX;
        if (curX > maxX) maxX = curX;
        if (curY < minY) minY = curY;
        if (curY > maxY) maxY = curY;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = curX + dx;
            const ny = curY + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIdx = ny * width + nx;
              if (isForeground[nIdx] && !visited[nIdx]) {
                visited[nIdx] = 1;
                queue.push(nIdx);
              }
            }
          }
        }
      }

      const count = pixels.length;
      blobs.push({
        pixels,
        minX, maxX, minY, maxY,
        cx: sumX / count,
        cy: sumY / count,
        count,
        avgR: sumR / count,
        avgG: sumG / count,
        avgB: sumB / count,
      });
    }
  }

  // 3단계: 덩어리 분류 (코 · 볼 · 땀 버림, 입, 눈 · 눈물 · 눈썹)
  // 고정 좌표를 쓰지 않고 실제 얼굴틀 그림의 윤곽/영역(fb)에서 위쪽/아래쪽을 계산
  const cx0 = fb.cx;
  const H = fb.height;
  const W = fb.width;
  const minY = fb.minY;

  // A. 볼(볼터치) 분류
  const cheekBlobs = new Set();
  // B. 땀(효과) 분류
  const sweatBlobs = new Set();
  // C. 코 분류
  const noseBlobs = new Set();
  // D. 입 분류
  const mouthBlobs = new Set();
  // E. 눈 및 눈썹 분류
  const eyeBlobs = new Set();

  for (const blob of blobs) {
    const relY = (blob.cy - minY) / H;
    const distX = Math.abs(blob.cx - cx0);
    const relX = distX / W;

    // 1. 볼(볼터치): 눈 아래 양옆(가운데 입 영역 제외)에 위치하고 볼터치 색상이거나 양옆 볼 영역
    const isBlushColor = (blob.avgR - blob.avgG >= 35 && blob.avgR >= 160);
    const isCheekPos = relX >= 0.16 && relY >= 0.70 && relY <= 0.92;
    if (isCheekPos && (isBlushColor || (relY >= 0.74 && relY <= 0.90))) {
      cheekBlobs.add(blob);
      continue;
    }

    // 2. 땀(물방울 등 효과): 눈에 이어지지 않은 독립 덩어리
    // 푸른색 물방울이 얼굴 중심에서 벗어난 양옆/외곽에 위치하거나, 얼굴틀 바깥에 위치한 덩어리
    const isBlueDrop = (blob.avgB > blob.avgR + 20 && blob.avgB > blob.avgG + 10);
    const isOutsideFace = blob.minX < fb.minX || blob.maxX > fb.maxX || blob.cy < fb.minY || blob.cy > fb.maxY;
    if ((isBlueDrop && (relX >= 0.18 || relY < 0.35)) || isOutsideFace) {
      sweatBlobs.add(blob);
      continue;
    }

    // 3. 코: 눈과 입 사이 정중앙 부근의 작은 덩어리 (보통 1~6칸)
    if (relX <= 0.12 && relY >= 0.74 && relY <= 0.86 && blob.count <= 6) {
      noseBlobs.add(blob);
      continue;
    }

    // 4. 입: 얼굴 아래쪽 가운데
    if (relX <= 0.22 && relY >= 0.86) {
      mouthBlobs.add(blob);
      continue;
    }

    // 5. 눈: 얼굴 위쪽 (눈, 눈물, 눈썹)
    if (relY < 0.84) {
      eyeBlobs.add(blob);
    }
  }

  // 할당 적용:
  for (const blob of mouthBlobs) {
    for (const idx of blob.pixels) {
      assignments[idx] = LABEL_MOUTH;
    }
  }

  for (const blob of eyeBlobs) {
    for (const idx of blob.pixels) {
      assignments[idx] = LABEL_EYES;
    }
  }

  // 사용자 수동 붓 수정 보존
  if (preservedAssignments && userModifiedMask) {
    for (let i = 0; i < width * height; i++) {
      if (userModifiedMask[i]) {
        assignments[i] = preservedAssignments[i];
      }
    }
  }

  return {
    assignments,
    kind: 'expression',
  };
}
