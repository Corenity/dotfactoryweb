// site/js/core/auto-slice.js — 종류별 자르기(헤어 · 표정 · 옷 · 신발 · 전체) 자동 조각 분할 순수 모듈
// 화면(DOM)을 쓰지 않는 순수 모듈로 Node 시험이 그대로 돌립니다.
import { sliceExpression } from './expression-slice.js';

export const SLICE_KINDS = Object.freeze(['all', 'outfit', 'shoes', 'hair', 'expression']);

export const PIECE_COLOR_MAP = Object.freeze({
  body: 'rgba(0, 122, 255, 0.55)',
  arm_l: 'rgba(255, 149, 0, 0.55)',
  arm_r: 'rgba(255, 204, 0, 0.55)',
  leg_l: 'rgba(88, 86, 214, 0.55)',
  leg_r: 'rgba(255, 45, 85, 0.55)',
  shoe_l: 'rgba(90, 200, 250, 0.55)',
  shoe_r: 'rgba(52, 199, 89, 0.55)',
  hair: 'rgba(162, 132, 94, 0.55)',
  eyes: 'rgba(0, 199, 190, 0.55)',
  mouth: 'rgba(255, 59, 48, 0.55)',
  extra: 'rgba(255, 214, 10, 0.55)',
});

export const PIECE_HEX_MAP = Object.freeze({
  body: '#007aff',
  arm_l: '#ff9500',
  arm_r: '#ffcc00',
  leg_l: '#5856d6',
  leg_r: '#ff2d55',
  shoe_l: '#5ac8fa',
  shoe_r: '#34c759',
  hair: '#a2845e',
  eyes: '#00c7be',
  mouth: '#ff3b30',
  extra: '#ffd60a',
});

export const KIND_PIECES_META = Object.freeze({
  all: [
    { sourceKind: 'hair', piece: 'hair', label: 1, name: '헤어' },
    { sourceKind: 'outfit', piece: 'body', label: 2, name: '몸' },
    { sourceKind: 'outfit', piece: 'arm_l', label: 3, name: '왼팔' },
    { sourceKind: 'outfit', piece: 'arm_r', label: 4, name: '오른팔' },
    { sourceKind: 'outfit', piece: 'leg_l', label: 5, name: '왼다리' },
    { sourceKind: 'outfit', piece: 'leg_r', label: 6, name: '오른다리' },
    { sourceKind: 'shoes', piece: 'shoe_l', label: 7, name: '왼신발' },
    { sourceKind: 'shoes', piece: 'shoe_r', label: 8, name: '오른신발' },
  ],
  outfit: [
    { sourceKind: 'outfit', piece: 'body', label: 1, name: '상체' },
    { sourceKind: 'outfit', piece: 'arm_l', label: 2, name: '왼팔' },
    { sourceKind: 'outfit', piece: 'arm_r', label: 3, name: '오른팔' },
    { sourceKind: 'outfit', piece: 'leg_l', label: 4, name: '왼다리' },
    { sourceKind: 'outfit', piece: 'leg_r', label: 5, name: '오른다리' },
  ],
  shoes: [
    { sourceKind: 'shoes', piece: 'shoe_l', label: 1, name: '왼신발' },
    { sourceKind: 'shoes', piece: 'shoe_r', label: 2, name: '오른신발' },
  ],
  hair: [
    { sourceKind: 'hair', piece: 'hair', label: 1, name: '머리' },
  ],
  expression: [
    { sourceKind: 'expression', piece: 'eyes', label: 1, name: '눈' },
    { sourceKind: 'expression', piece: 'mouth', label: 2, name: '입' },
  ],
});

const OUTFIT_Z_PRIORITY = { arm_l: 12, arm_r: 12, body: 10, leg_l: 8, leg_r: 8 };

/**
 * 기본 맨몸 레이어들로부터 합성 맨몸 이미지, zIndex 우선순위가 반영된 부위 맵,
 * 각 부위별 불투명 픽셀 좌표 목록을 생성합니다.
 */
export function buildBareInfo(layers, width = 72, height = 64) {
  const bareImage = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  const barePartMap = new Array(width * height).fill(null);
  const zMap = new Int16Array(width * height).fill(-999);

  const partPixels = {
    body: [],
    arm_l: [],
    arm_r: [],
    leg_l: [],
    leg_r: [],
    face: [],
  };

  for (const layer of layers || []) {
    if (!layer || !layer.image) continue;
    const img = layer.image;
    let partId = null;
    const p = layer.piece || layer.id;
    if (p === 'torso' || p === 'bare_torso' || p === 'body') partId = 'body';
    else if (p === 'arm_l' || p === 'bare_arm_l') partId = 'arm_l';
    else if (p === 'arm_r' || p === 'bare_arm_r') partId = 'arm_r';
    else if (p === 'leg_l' || p === 'bare_leg_l') partId = 'leg_l';
    else if (p === 'leg_r' || p === 'bare_leg_r') partId = 'leg_r';

    const isFace = p === 'face' || p === 'face_face' || layer.slot === 'face' || p === 'head';

    const z = Number.isFinite(Number(layer.zIndex)) ? Number(layer.zIndex) : 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const s = idx * 4;
        const a = img.data[s + 3];
        if (a > 0) {
          if (isFace) {
            partPixels.face.push([x, y]);
          }
          if (z >= zMap[idx]) {
            zMap[idx] = z;
            bareImage.data[s] = img.data[s];
            bareImage.data[s + 1] = img.data[s + 1];
            bareImage.data[s + 2] = img.data[s + 2];
            bareImage.data[s + 3] = a;
            if (partId) barePartMap[idx] = partId;
          }
        }
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const part = barePartMap[idx];
      if (part && partPixels[part]) {
        partPixels[part].push([x, y]);
      }
    }
  }

  let faceBounds = null;
  if (partPixels.face.length > 0) {
    let minX = width, maxX = -1, minY = height, maxY = -1;
    let sumX = 0, sumY = 0;
    for (const [x, y] of partPixels.face) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;
    }
    const count = partPixels.face.length;
    faceBounds = {
      minX, maxX, minY, maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      cx: sumX / count,
      cy: sumY / count,
      count,
    };
  }

  return { bareImage, barePartMap, partPixels, facePixels: partPixels.face, faceBounds, width, height };
}

/**
 * 맨몸 밖 칸에 대해 5개 부위 중 유클리드 최단 거리가 가장 가까운 부위를 찾습니다.
 * 동률인 경우 zIndex가 높은 쪽을 우선합니다.
 */
export function findNearestOutfitPart(x, y, partPixels) {
  let bestPart = 'body';
  let bestDistSq = Infinity;
  let bestZ = -1;

  for (const part of ['arm_l', 'arm_r', 'body', 'leg_l', 'leg_r']) {
    const pts = partPixels[part];
    if (!pts || pts.length === 0) continue;
    let minD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dx = x - pts[i][0];
      const dy = y - pts[i][1];
      const d = dx * dx + dy * dy;
      if (d < minD) minD = d;
      if (d === 0) break;
    }
    const z = OUTFIT_Z_PRIORITY[part] || 0;
    if (minD < bestDistSq || (minD === bestDistSq && z > bestZ)) {
      bestDistSq = minD;
      bestPart = part;
      bestZ = z;
    }
  }
  return bestPart;
}

/**
 * 신발 칸에 대해 왼다리/오른다리 중 더 가까운 쪽을 찾습니다.
 */
export function findNearestShoePart(x, y, partPixels) {
  const ptsL = partPixels.leg_l || [];
  const ptsR = partPixels.leg_r || [];
  let minL = Infinity, minR = Infinity;

  for (let i = 0; i < ptsL.length; i++) {
    const dx = x - ptsL[i][0], dy = y - ptsL[i][1];
    const d = dx * dx + dy * dy;
    if (d < minL) minL = d;
    if (d === 0) break;
  }
  for (let i = 0; i < ptsR.length; i++) {
    const dx = x - ptsR[i][0], dy = y - ptsR[i][1];
    const d = dx * dx + dy * dy;
    if (d < minR) minR = d;
    if (d === 0) break;
  }

  if (minL < minR) return 'shoe_l';
  if (minR < minL) return 'shoe_r';
  return x >= 36 ? 'shoe_l' : 'shoe_r';
}

/**
 * 올린 그림의 (x, y) 색상이 맨몸 합성의 해당 칸 색상과 가까운지 판정합니다.
 */
export function isBareColor(r, g, b, bareR, bareG, bareB, bareA, tolerance = 12) {
  if (bareA === 0) return false;
  const dr = r - bareR;
  const dg = g - bareG;
  const db = b - bareB;
  return Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance;
}

/**
 * 두 색상 사이의 거리가 오차 범위 내인지 판정합니다.
 */
export function isSameBareColor(r, g, b, bareR, bareG, bareB, tolerance = 12) {
  const dr = r - bareR;
  const dg = g - bareG;
  const db = b - bareB;
  return Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance;
}

/**
 * 좌표 (x, y)가 타원 내부에 있는지 판정합니다.
 */
export function isInsideEllipse(x, y, cx = 38, cy = 30, rx = 12, ry = 8) {
  if (rx <= 0 || ry <= 0) return false;
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return (dx * dx + dy * dy) <= 1.0;
}

/**
 * 올린 그림에서 맨몸 얼굴 타원 영역을 분석하여 지피티가 칠한 살색 그늘 후보 색상들을 자동으로 추출합니다.
 * 볼터치 분홍(r - g >= 70)과 크림 머리색(247, 220, 192 계열)을 배제하여 진짜 살색을 우선 추출합니다.
 */
export function extractSkinColors(image, bareInfo, faceEllipse = { cx: 38, cy: 30, rx: 12, ry: 8 }) {
  const { width, height } = image;
  const { cx = 38, cy = 30, rx = 12, ry = 8 } = faceEllipse || {};
  const bareImg = bareInfo?.bareImage;
  const colorMap = new Map();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const s = idx * 4;
      if (image.data[s + 3] === 0) continue;
      const r = image.data[s], g = image.data[s + 1], b = image.data[s + 2];

      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      // 얼굴 타원 안쪽 중심부
      if (dx * dx + dy * dy > 0.8) continue;
      if (bareImg && bareImg.data[s + 3] === 0) continue;

      // 눈 흰자위(순백색) 제외
      if (r >= 245 && g >= 245 && b >= 245) continue;
      // 어두운 눈/입술선/눈썹 제외
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      if (brightness < 120) continue;

      // 1) 볼터치 분홍 제외: 빨강이 초록보다 70 이상 큰 색
      if (r - g >= 70) continue;

      // 2) 크림 머리색(247, 220, 192 계열) 제외: 노랑/크림 톤은 g-b, r-b가 큼
      if (g - b >= 20 || r - b >= 48) continue;

      // 살색 그늘 조건
      if (r >= 200 && g >= 140 && b >= 120) {
        const qr = Math.round(r / 6) * 6;
        const qg = Math.round(g / 6) * 6;
        const qb = Math.round(b / 6) * 6;
        const key = `${qr},${qg},${qb}`;
        const cur = colorMap.get(key) || { r, g, b, count: 0 };
        cur.count++;
        colorMap.set(key, cur);
      }
    }
  }

  const sorted = [...colorMap.values()].sort((a, b) => b.count - a.count);
  return sorted.slice(0, 4).map(c => [c.r, c.g, c.b]);
}

/**
 * 종류별 자르기 알고리즘 본체입니다.
 * 기본값: tolerance 12, faceEllipse (38,30,12,8), shoeMinY 52.
 * 헤어색 복원 및 손 윤곽선 버림을 내장합니다.
 */
export function autoSlice({
  image,
  kind = 'all',
  bareInfo = null,
  stripBare = null,
  tolerance = 12,
  offset = [0, 0],
  faceEllipse = { cx: 38, cy: 30, rx: 12, ry: 8 },
  shoeMinY = 52,
  neckY = 37,
  preservedAssignments = null,
  userModifiedMask = null,
  skinColors = null,
  skinTolerance = 14,
}) {
  if (kind === 'expression') {
    return sliceExpression({
      image,
      bareInfo,
      stripBare,
      tolerance,
      faceEllipse,
      preservedAssignments,
      userModifiedMask,
      skinColors,
      skinTolerance,
    });
  }

  const width = image.width;
  const height = image.height;
  const shouldStrip = stripBare !== null ? !!stripBare : true;
  const [ox, oy] = offset;

  const assignments = new Uint8Array(width * height);
  const metas = KIND_PIECES_META[kind] || KIND_PIECES_META.all;
  const labelByPiece = {};
  for (const m of metas) labelByPiece[m.piece] = m.label;

  const bareImg = bareInfo?.bareImage;
  const barePartMap = bareInfo?.barePartMap;
  const partPixels = bareInfo?.partPixels || {};
  const { cx = 38, cy = 30, rx = 12, ry = 8 } = faceEllipse || {};

  // 살색 목록이 지정되지 않은 경우 맨몸 정보로부터 자동 추출
  let activeSkinColors = skinColors;
  if (!activeSkinColors && bareInfo) {
    activeSkinColors = extractSkinColors(image, bareInfo, faceEllipse);
  }
  if (!activeSkinColors) activeSkinColors = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const destIdx = y * width + x;

      // 이미 수정한 칸 보존
      if (preservedAssignments && userModifiedMask && userModifiedMask[destIdx]) {
        assignments[destIdx] = preservedAssignments[destIdx];
        continue;
      }

      const srcX = x - ox;
      const srcY = y - oy;
      if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) continue;

      const srcIdx = srcY * width + srcX;
      const s = srcIdx * 4;
      const a = image.data[s + 3];
      if (a === 0) continue;

      const r = image.data[s];
      const g = image.data[s + 1];
      const b = image.data[s + 2];

      // 1. 기본 맨몸 살색 빼기 (맨몸 합성과 tolerance 이내인 칸 버림)
      if (shouldStrip && bareImg) {
        const bs = destIdx * 4;
        const ba = bareImg.data[bs + 3];
        if (ba > 0 && isBareColor(r, g, b, bareImg.data[bs], bareImg.data[bs + 1], bareImg.data[bs + 2], ba, tolerance)) {
          continue;
        }
      }

      // 2. 살색 목록(그늘 등) 색상 빼기
      // 버리는 자리는 얼굴 타원 안과 맨몸 몸통·팔·다리 자리(body, arm_l, arm_r, leg_l, leg_r)뿐입니다.
      if (shouldStrip && activeSkinColors.length > 0) {
        const inEllipse = isInsideEllipse(x, y, cx, cy, rx, ry);
        const barePart = barePartMap ? barePartMap[destIdx] : null;
        const inBodyLimb = (barePart === 'body' || barePart === 'arm_l' || barePart === 'arm_r' || barePart === 'leg_l' || barePart === 'leg_r');

        if (inEllipse || inBodyLimb) {
          let isSkin = false;
          for (let i = 0; i < activeSkinColors.length; i++) {
            const sc = activeSkinColors[i];
            const dr = r - sc[0];
            const dg = g - sc[1];
            const db = b - sc[2];
            if (Math.sqrt(dr * dr + dg * dg + db * db) <= skinTolerance) {
              isSkin = true;
              break;
            }
          }
          if (isSkin) continue;
        }
      }

      if (kind === 'all') {
        // 1. 얼굴 타원 안 = 표정 영역 (임시 255 마킹 후 헤어색 복원만 hair로, 나머지는 버림)
        if (isInsideEllipse(x, y, cx, cy, rx, ry)) {
          assignments[destIdx] = 255;
          continue;
        }

        // 2. 발 쪽 = 신발 (shoe_l, shoe_r)
        if (y >= shoeMinY) {
          const shoePart = findNearestShoePart(x, y, partPixels);
          assignments[destIdx] = labelByPiece[shoePart] || 7;
          continue;
        }

        // 3. 머리 쪽 = 헤어 (hair)
        let isHair = false;
        if (y < neckY) {
          isHair = true;
        } else {
          const barePart = barePartMap ? barePartMap[destIdx] : null;
          if (!barePart && y <= 42) {
            const distToHeadSq = (x - cx) * (x - cx) + (y - cy) * (y - cy);
            const distToTorsoSq = (x - 37) * (x - 37) + (y - 43) * (y - 43);
            if (distToHeadSq < distToTorsoSq && Math.abs(x - cx) <= rx * 1.5) {
              isHair = true;
            }
          }
        }

        if (isHair) {
          assignments[destIdx] = labelByPiece.hair || 1;
          continue;
        }

        // 4. 나머지 = 옷 5조각
        let part = barePartMap ? barePartMap[destIdx] : null;
        if (!part) {
          part = findNearestOutfitPart(x, y, partPixels);
        }
        assignments[destIdx] = labelByPiece[part] || 2;
      } else if (kind === 'hair') {
        assignments[destIdx] = labelByPiece.hair || 1;
      } else if (kind === 'shoes') {
        const shoePart = findNearestShoePart(x, y, partPixels);
        assignments[destIdx] = labelByPiece[shoePart] || 1;
      } else {
        let part = barePartMap ? barePartMap[destIdx] : null;
        if (!part) {
          part = findNearestOutfitPart(x, y, partPixels);
        }
        assignments[destIdx] = labelByPiece[part] || 1;
      }
    }
  }

  // kind === 'all' 전용 다듬기
  if (kind === 'all') {
    const d = image.data;
    const N = width * height;
    const bright = i => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const nb4 = i => {
      const px = i % width, py = (i / width) | 0, r = [];
      if (px) r.push(i - 1);
      if (px < width - 1) r.push(i + 1);
      if (py) r.push(i - width);
      if (py < height - 1) r.push(i + width);
      return r;
    };
    const nb8 = i => {
      const px = i % width, py = (i / width) | 0, r = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const X = px + dx, Y = py + dy;
          if (X >= 0 && X < width && Y >= 0 && Y < height) r.push(Y * width + X);
        }
      }
      return r;
    };
    const dropped = i => d[i * 4 + 3] > 0 && !assignments[i];

    // 1) 헤어색 복원: 타원 안 표정(255) 칸 중 타원 밖 헤어 주요 색상은 헤어로 복원
    const hairCnt = new Map();
    for (let i = 0; i < N; i++) {
      if (assignments[i] !== labelByPiece.hair) continue;
      if (isInsideEllipse(i % width, (i / width) | 0, cx, cy, rx, ry)) continue;
      if (bright(i) < 170) continue;
      const k = `${Math.round(d[i * 4] / 6) * 6},${Math.round(d[i * 4 + 1] / 6) * 6},${Math.round(d[i * 4 + 2] / 6) * 6}`;
      const c = hairCnt.get(k) || { c: [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]], n: 0 };
      c.n++;
      hairCnt.set(k, c);
    }
    const hairPal = [...hairCnt.values()].sort((a, b) => b.n - a.n).slice(0, 6).map(v => v.c);
    if (hairPal.length > 0) {
      for (let i = 0; i < N; i++) {
        if (assignments[i] === 255) {
          if (userModifiedMask && userModifiedMask[i]) continue;
          if (hairPal.some(p => Math.hypot(d[i * 4] - p[0], d[i * 4 + 1] - p[1], d[i * 4 + 2] - p[2]) <= 12)) {
            assignments[i] = labelByPiece.hair;
          }
        }
      }
    }

    // 2) 손 윤곽선 버림: 버린 살에 닿고 보호되는 옷 면(밝은 옷색 또는 어두운 옷 코어)엔 안 닿는 어두운 칸은 옷 조각에서 버림 (2패스)
    const outfitLabels = new Set([
      labelByPiece.body,
      labelByPiece.arm_l,
      labelByPiece.arm_r,
      labelByPiece.leg_l,
      labelByPiece.leg_r,
    ]);
    const initialDropped = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (dropped(i)) initialDropped[i] = 1;
    }
    const coreColorCnt = new Map();
    const darkCoreCand = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (!outfitLabels.has(assignments[i])) continue;
      const br = bright(i);
      if (br < 40 || br >= 110) continue;
      if (nb8(i).some(j => initialDropped[j])) continue;
      if (nb4(i).some(j => d[j * 4 + 3] === 0)) continue;
      darkCoreCand[i] = 1;
      if (assignments[i] === labelByPiece.body) {
        const k = `${Math.round(d[i * 4] / 6) * 6},${Math.round(d[i * 4 + 1] / 6) * 6},${Math.round(d[i * 4 + 2] / 6) * 6}`;
        coreColorCnt.set(k, (coreColorCnt.get(k) || 0) + 1);
      }
    }
    const hasDarkOutfitCore = [...coreColorCnt.values()].some(cnt => cnt >= 12);
    const isProtectedFill = i => bright(i) >= 110 || (hasDarkOutfitCore && darkCoreCand[i] === 1);
    for (let pass = 0; pass < 2; pass++) {
      const kill = [];
      for (let i = 0; i < N; i++) {
        if (!assignments[i] || !outfitLabels.has(assignments[i])) continue;
        if (userModifiedMask && userModifiedMask[i]) continue;
        if (isProtectedFill(i)) continue;
        if (!nb8(i).some(dropped)) continue;
        if (nb4(i).some(j => assignments[j] && isProtectedFill(j) && !dropped(j))) continue;
        kill.push(i);
      }
      for (const idx of kill) assignments[idx] = 0;
    }

    // 3) 전체 모드 결과에서 표정 조각 제외: 헤어로 복원되지 않고 남은 표정(255) 칸을 모두 버림(0)
    for (let i = 0; i < N; i++) {
      if (assignments[i] === 255) {
        assignments[i] = 0;
      }
    }
  }

  return {
    kind,
    width,
    height,
    assignments,
    offset: [ox, oy],
    stripBare: shouldStrip,
    faceEllipse: { cx, cy, rx, ry },
    skinColors: activeSkinColors,
    metas,
  };
}

/**
 * assignments 할당 결과로부터 각 부위별 조각 이미지 버퍼를 추출합니다.
 */
export function extractPiecesFromAssignments({ image, assignments, kind = 'all', offset = [0, 0] }) {
  const width = image.width;
  const height = image.height;
  const [ox, oy] = offset;
  const metas = KIND_PIECES_META[kind] || KIND_PIECES_META.all;
  const result = [];

  for (const meta of metas) {
    const pieceData = new Uint8ClampedArray(width * height * 4);
    let pixelCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const destIdx = y * width + x;

        if (assignments[destIdx] === meta.label) {
          const srcX = x - ox;
          const srcY = y - oy;
          if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
            const ss = (srcY * width + srcX) * 4;
            const ds = destIdx * 4;
            pieceData[ds] = image.data[ss];
            pieceData[ds + 1] = image.data[ss + 1];
            pieceData[ds + 2] = image.data[ss + 2];
            pieceData[ds + 3] = image.data[ss + 3];
            pixelCount++;
          }
        }
      }
    }

    if (pixelCount > 0) {
      result.push({
        sourceKind: meta.sourceKind,
        piece: meta.piece,
        name: `${meta.sourceKind}_${meta.piece}`,
        pixelCount,
        image: { width, height, data: pieceData },
      });
    }
  }

  return result;
}

/**
 * 되돌리기/다시하기 시 자동 분할 초기화(init)가 필요한지 판정하는 순수 함수입니다.
 * 이전 그림과 새 그림이 같으면(크기 및 픽셀 데이터 동일) 사용자가 붓으로 수정한 칸(userModifiedMask)을
 * 보존하기 위해 다시 나누지 않고(false), 그림이 실제로 바뀌었을 때만 다시 나눕니다(true).
 */
export function shouldReinitSlice(prevImage, nextImage) {
  if (prevImage === nextImage) return false;
  if (!prevImage || !nextImage) return true;
  if (prevImage.width !== nextImage.width || prevImage.height !== nextImage.height) return true;
  const d1 = prevImage.data;
  const d2 = nextImage.data;
  if (!d1 || !d2 || d1.length !== d2.length) return true;
  for (let i = 0; i < d1.length; i++) {
    if (d1[i] !== d2[i]) return true;
  }
  return false;
}
