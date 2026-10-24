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
 * 표준 초록(3, 192, 55)뿐 아니라 지피티 변형 초록(3, 203, 47) 및 밝은 연두색 찌꺼기까지 배경으로 처리합니다.
 */
function isBackgroundKey(r, g, b, a) {
  if (a === 0) return true;
  // 표준 초록 (3, 192, 55) 및 지피티 변형 초록 (3, 203, 47) 등
  if (g >= 140 && r <= 60 && b <= 80) return true;
  if (Math.hypot(r - 3, g - 192, b - 55) <= 30) return true;
  // 밝은 연두색 및 초록 찌꺼기 칸
  if (g >= 120 && g > r + 30 && g > b + 30) return true;
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
  const minX = 22, maxX = 50, minY = 9, maxY = 36;
  return {
    minX, maxX, minY, maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    cx: 38,
    cy: 22.5,
    count: 0,
  };
}

/**
 * 대머리 얼굴 그림에서 눈(눈·눈물·눈썹)과 입을 분할하고 코·볼·땀·외곽 윤곽선을 버립니다.
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
  const barePartMap = bareInfo?.barePartMap;
  const fb = getFaceBounds(bareInfo, width, height);
  const faceCenterX = 38; // 정면 얼굴 좌우 대칭 중심축

  // 살색 목록 추출
  let activeSkinColors = skinColors;
  if (!activeSkinColors && bareInfo) {
    const effEllipse = faceEllipse || {
      cx: faceCenterX,
      cy: Math.round(fb.cy),
      rx: Math.round(fb.width * 0.4),
      ry: Math.round(fb.height * 0.3),
    };
    activeSkinColors = extractSkinColors(image, bareInfo, effEllipse);
  }
  if (!activeSkinColors) activeSkinColors = [];

  // 1단계 A: 배경 거리 BFS 맵 계산 (배경에서부터의 거리)
  // 얼굴 외곽선이 얼굴틀과 몇 칸 어긋나더라도 외곽 테두리를 정확히 판별하기 위함
  const distToBg = new Int32Array(width * height).fill(999);
  const q = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const s = idx * 4;
      if (isBackgroundKey(d[s], d[s + 1], d[s + 2], d[s + 3])) {
        distToBg[idx] = 0;
        q.push(idx);
      }
    }
  }
  while (q.length > 0) {
    const cur = q.shift();
    const cx0 = cur % width;
    const cy0 = (cur / width) | 0;
    const cd = distToBg[cur];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx0 + dx;
      const ny = cy0 + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = ny * width + nx;
        if (distToBg[nIdx] > cd + 1) {
          distToBg[nIdx] = cd + 1;
          q.push(nIdx);
        }
      }
    }
  }

  // 1단계 B: 유효 표시 픽셀(초록 배경, 살색, 외곽 테두리선 제외) 마스크 생성
  const isForeground = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const s = idx * 4;
      const a = d[s + 3];
      if (a === 0) continue;

      const r = d[s], g = d[s + 1], b = d[s + 2];
      if (isBackgroundKey(r, g, b, a)) continue;

      // 몸통 부위 제거 (barePartMap이 있으면 몸통 영역은 표정 대상이 아님)
      if (barePartMap) {
        const bp = barePartMap[idx];
        if (bp && bp !== 'face') continue;
      }
      // 턱 끝 아래줄(몸통 영역)은 표정 대상 아님
      if (y > fb.maxY) continue;

      const distX = Math.abs(x - faceCenterX);
      const relX = distX / fb.width;
      const relY = (y - fb.minY) / fb.height;

      // 얼굴 외곽 윤곽선(얼굴 테두리선) 제거:
      // 얼굴틀(bareInfo)이 있고 실제 살색/맨몸 바탕이 존재하는 실제 얼굴 그림일 때만 윤곽선 제거 적용
      const hasBareFace = !!(bareInfo && (bareImg || activeSkinColors.length > 0));
      if (hasBareFace) {
        // 배경에 직접 맞닿은 1칸 테두리선은 윤곽선이므로 제거
        if (distToBg[idx] <= 1) continue;
        // 정수리/이마 위쪽 2겹 테두리선 제거
        if (y <= fb.minY + 2 && distToBg[idx] <= 2) continue;
        // 얼굴 좌우 외곽 2겹 테두리선 제거
        if (relX >= 0.35 && distToBg[idx] <= 2) continue;
        // 턱선 양옆 2겹 테두리선 제거 (중앙 입 구역 distX <= 3 제외)
        if (y >= fb.maxY - 2 && distX > 3.0 && distToBg[idx] <= 2) continue;
      }

      // 볼터치 픽셀 즉시 제거: 양 볼 위치(distX >= 3.5 또는 relX >= 0.12, relY >= 0.55)이고 붉은 볼터치 색상
      const isBlush = (r - g >= 35 && r >= 160);
      if ((distX >= 3.5 || relX >= 0.12) && relY >= 0.55 && isBlush) continue;

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
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        cx: sumX / count,
        cy: sumY / count,
        count,
        avgR: sumR / count,
        avgG: sumG / count,
        avgB: sumB / count,
      });
    }
  }

  // 3단계: 덩어리 분류 (코 · 볼 · 땀 · 이마 표시 · 윤곽선 잔여물 버림, 중앙 코/입 분류, 눈 · 눈물 · 눈썹)
  const centerBlobs = [];
  const otherBlobs = [];

  for (const blob of blobs) {
    const relY = (blob.cy - fb.minY) / fb.height;
    const distX = Math.abs(blob.cx - faceCenterX);
    const relX = distX / fb.width;

    // 1. 이마 위쪽 표시(하트 등)/정수리 윤곽선: 눈썹보다 위쪽 (relY < 0.25) 배제
    if (relY < 0.25) continue;

    // 2. 얼굴 좌우 외곽 점/귀 윤곽선 배제
    if (relX >= 0.32 && relY >= 0.55) continue;
    if (relX >= 0.44) continue;

    // 3. 땀(물방울 등 효과) 및 외곽 푸른 점 배제
    const isBlueDrop = (blob.avgB > blob.avgR + 20 && blob.avgB > blob.avgG + 10);
    const isOutsideFace = blob.minX < fb.minX || blob.maxX > fb.maxX || blob.cy < fb.minY || blob.cy > fb.maxY;
    if ((isBlueDrop && (relX >= 0.28 || relY < 0.35)) || isOutsideFace) {
      continue;
    }

    // 4. 볼(볼터치) 잔여물 배제: 볼터치 색상이면서 양 볼 영역
    const isBlushColor = (blob.avgR - blob.avgG >= 35 && blob.avgR >= 160);
    const isCheekPos = relX >= 0.16 && relY >= 0.65 && relY <= 0.90;
    if (isCheekPos && isBlushColor) {
      continue;
    }

    // 5. 중앙 코/입 후보 (얼굴 중심선 부근 distX <= 3.0, relY >= 0.65)
    if (distX <= 3.0 && relY >= 0.65) {
      centerBlobs.push(blob);
    } else if (relY >= 0.25 && relY < 0.78) {
      // 6. 눈 및 눈썹 후보 (relY 0.25 ~ 0.78)
      otherBlobs.push(blob);
    }
  }

  const mouthBlobs = new Set();
  const eyeBlobs = new Set(otherBlobs);

  // 중앙 코/입 분류: 세로 위치(cy) 순서로 정렬
  centerBlobs.sort((a, b) => a.cy - b.cy);

  // 최하단 덩어리가 턱선 잔여물인지 판정:
  // 바로 위에 이미 입 후보(relY >= 0.75 및 width >= 2 또는 count >= 2)가 존재하면 최하단 턱선 잔여물 제거
  if (centerBlobs.length >= 2) {
    const last = centerBlobs[centerBlobs.length - 1];
    const prev = centerBlobs[centerBlobs.length - 2];
    const lastRelY = (last.cy - fb.minY) / fb.height;
    const prevRelY = (prev.cy - fb.minY) / fb.height;
    const prevIsMouthCandidate = prevRelY >= 0.75 && (prev.width >= 2 || prev.count >= 2);
    if (lastRelY >= 0.93 && prevIsMouthCandidate) {
      centerBlobs.pop();
    }
  }

  if (centerBlobs.length === 1) {
    const b = centerBlobs[0];
    const relY = (b.cy - fb.minY) / fb.height;
    // 폭이 2 이상이거나 하단(relY >= 0.78)이면 입
    if (b.width >= 2 || relY >= 0.78) {
      mouthBlobs.add(b);
    } // 단일 점이고 상대적으로 위쪽이면 코(버림)
  } else if (centerBlobs.length >= 2) {
    // 가장 아래에 있는 덩어리가 입! 그 위의 덩어리는 코(버림)
    const lowest = centerBlobs[centerBlobs.length - 1];
    mouthBlobs.add(lowest);
  }

  // 4단계: 할당 적용
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
