// 종류별 자르기(헤어 · 표정 · 옷 · 신발 · 전체) 자동 조각 분할 순수 모듈
// 화면(DOM)을 쓰지 않는 순수 모듈로 Node 시험이 그대로 돌립니다.

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
  extra: '#ffd60a',
});

export const KIND_PIECES_META = Object.freeze({
  all: [
    { sourceKind: 'hair', piece: 'hair', label: 1, name: '헤어' },
    { sourceKind: 'expression', piece: 'eyes', label: 2, name: '표정' },
    { sourceKind: 'outfit', piece: 'body', label: 3, name: '상체' },
    { sourceKind: 'outfit', piece: 'arm_l', label: 4, name: '왼팔' },
    { sourceKind: 'outfit', piece: 'arm_r', label: 5, name: '오른팔' },
    { sourceKind: 'outfit', piece: 'leg_l', label: 6, name: '왼다리' },
    { sourceKind: 'outfit', piece: 'leg_r', label: 7, name: '오른다리' },
    { sourceKind: 'shoes', piece: 'shoe_l', label: 8, name: '왼신발' },
    { sourceKind: 'shoes', piece: 'shoe_r', label: 9, name: '오른신발' },
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
    { sourceKind: 'expression', piece: 'eyes', label: 1, name: '표정' },
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

    const z = Number.isFinite(Number(layer.zIndex)) ? Number(layer.zIndex) : 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const s = idx * 4;
        const a = img.data[s + 3];
        if (a > 0) {
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

  return { bareImage, barePartMap, partPixels, width, height };
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
export function isBareColor(r, g, b, bareR, bareG, bareB, bareA, tolerance = 24) {
  if (bareA === 0) return false;
  const dr = r - bareR;
  const dg = g - bareG;
  const db = b - bareB;
  return Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance;
}

/**
 * 좌표 (x, y)가 타원 내부에 있는지 판정합니다.
 */
export function isInsideEllipse(x, y, cx = 36.5, cy = 30, rx = 10.5, ry = 8) {
  if (rx <= 0 || ry <= 0) return false;
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return (dx * dx + dy * dy) <= 1.0;
}

/**
 * 올린 그림에서 맨몸 얼굴 타원 영역을 분석하여 지피티가 칠한 살색 그늘 후보 색상들을 자동으로 추출합니다.
 * 눈/눈썹/입술선이나 눈 흰자위, 진한 분홍 볼터치는 살색에서 제외하여 보호합니다.
 * 맨몸이 있는 칸(bareImage 알파 > 0)에서만 추출하여 머리카락 등이 살색 후보로 들어가는 것을 방지합니다.
 */
export function extractSkinColors(image, bareInfo, faceEllipse = { cx: 36.5, cy: 30, rx: 10.5, ry: 8 }) {
  const { width, height } = image;
  const { cx = 36.5, cy = 30, rx = 10.5, ry = 8 } = faceEllipse || {};
  const bareImg = bareInfo?.bareImage;
  const colorMap = new Map();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1.0) {
        const s = (y * width + x) * 4;
        if (image.data[s + 3] === 0) continue;
        const r = image.data[s], g = image.data[s + 1], b = image.data[s + 2];

        // 기본 맨몸 살색과 이미 가까우면 제외 (bareColor에서 기본으로 빠짐), 맨몸 밖 픽셀도 제외
        if (bareImg) {
          const ba = bareImg.data[s + 3];
          if (ba === 0) continue; // 맨몸이 없는 칸(얼굴 밖)은 살색 후보에서 제외
          if (isBareColor(r, g, b, bareImg.data[s], bareImg.data[s + 1], bareImg.data[s + 2], ba, 24)) {
            continue;
          }
        }

        // 눈 흰자위(거의 순백색) 제외
        if (r >= 245 && g >= 245 && b >= 245) continue;
        if (r - b < 12) continue;

        // 어두운 눈/입술선/눈썹 제외 (밝기 < 130)
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        if (brightness < 130) continue;

        // 살색 그늘: R이 높고, G와 B가 적당히 밝음 (r >= 230, g >= 140, b >= 130)
        // 진한 분홍 볼터치(r - g > 95 또는 g < 135)는 표정에 남기기 위해 살색 그늘에서 제외
        if (r >= 230 && g >= 140 && b >= 130 && (r - g) <= 95) {
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
  }

  const sorted = [...colorMap.values()].sort((a, b) => b.count - a.count);
  return sorted.slice(0, 4).map(c => [c.r, c.g, c.b]);
}

/**
 * 「눌러서 떼기」(장식): 그림 칸을 한 번 누르면 그 칸과 같은 색으로 이어진(4방향) 칸과
 * 그 덩어리에 닿은 테두리(어두운 외곽선) 칸을 장식으로 고릅니다.
 */
export function pickDecoration({
  image,
  startX,
  startY,
  offset = [0, 0],
  darkOutlineThreshold = 80,
  colorTolerance = 24,
}) {
  const width = image.width;
  const height = image.height;
  const [ox, oy] = offset;

  const srcStartX = startX - ox;
  const srcStartY = startY - oy;
  if (srcStartX < 0 || srcStartX >= width || srcStartY < 0 || srcStartY >= height) {
    return { core: [], outline: [], all: [], mask: new Uint8Array(width * height) };
  }

  const s0 = (srcStartY * width + srcStartX) * 4;
  if (image.data[s0 + 3] === 0) {
    return { core: [], outline: [], all: [], mask: new Uint8Array(width * height) };
  }

  const targetR = image.data[s0];
  const targetG = image.data[s0 + 1];
  const targetB = image.data[s0 + 2];

  const visited = new Uint8Array(width * height);
  const core = [];
  const queue = [[srcStartX, srcStartY]];
  visited[srcStartY * width + srcStartX] = 1;

  while (queue.length > 0) {
    const [cx, cy] = queue.shift();
    core.push([cx + ox, cy + oy]);

    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nidx = ny * width + nx;
      if (visited[nidx]) continue;
      const ns = nidx * 4;
      if (image.data[ns + 3] === 0) continue;

      const dr = image.data[ns] - targetR;
      const dg = image.data[ns + 1] - targetG;
      const db = image.data[ns + 2] - targetB;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist <= colorTolerance) {
        visited[nidx] = 1;
        queue.push([nx, ny]);
      }
    }
  }

  const outline = [];
  const outlineVisited = new Uint8Array(width * height);
  for (const [px, py] of core) {
    const cx = px - ox;
    const cy = py - oy;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nidx = ny * width + nx;
      if (visited[nidx] || outlineVisited[nidx]) continue;
      const ns = nidx * 4;
      if (image.data[ns + 3] === 0) continue;

      const r = image.data[ns], g = image.data[ns + 1], b = image.data[ns + 2];
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      if (brightness <= darkOutlineThreshold) {
        outlineVisited[nidx] = 1;
        outline.push([nx + ox, ny + oy]);
      }
    }
  }

  const all = [...core, ...outline];
  const mask = new Uint8Array(width * height);
  for (const [x, y] of all) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      mask[y * width + x] = 1;
    }
  }

  return { core, outline, all, mask };
}

/**
 * 종류별 자르기 알고리즘 본체입니다.
 */
export function autoSlice({
  image,
  kind = 'outfit',
  bareInfo = null,
  stripBare = null,
  tolerance = 24,
  offset = [0, 0],
  faceEllipse = { cx: 36.5, cy: 30, rx: 10.5, ry: 8 },
  shoeMinY = 55,
  neckY = 37,
  preservedAssignments = null,
  userModifiedMask = null,
  skinColors = [],
  skinTolerance = 14,
}) {
  const width = image.width;
  const height = image.height;
  const shouldStrip = stripBare !== null ? !!stripBare : (kind === 'outfit' || kind === 'shoes' || kind === 'all');
  const [ox, oy] = offset;

  const assignments = new Uint8Array(width * height);
  const metas = KIND_PIECES_META[kind] || KIND_PIECES_META.outfit;
  const labelByPiece = {};
  for (const m of metas) labelByPiece[m.piece] = m.label;

  const bareImg = bareInfo?.bareImage;
  const barePartMap = bareInfo?.barePartMap;
  const partPixels = bareInfo?.partPixels || {};
  const { cx = 36.5, cy = 30, rx = 10.5, ry = 8 } = faceEllipse || {};

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const destIdx = y * width + x;

      // 이미 사용자가 붓으로 고친 칸은 보존
      if (userModifiedMask && userModifiedMask[destIdx] && preservedAssignments) {
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

      // 1. 기본 맨몸 살색 빼기 (맨몸 합성과 tolerance 24 이내인 칸 버림)
      if (shouldStrip && bareImg) {
        const bs = destIdx * 4;
        const ba = bareImg.data[bs + 3];
        if (ba > 0 && isBareColor(r, g, b, bareImg.data[bs], bareImg.data[bs + 1], bareImg.data[bs + 2], ba, tolerance)) {
          continue;
        }
      }

      // 2. 살색 목록(그늘 등) 색상 빼기
      // 버리는 자리는 얼굴 타원 안과 맨몸 몸통·팔·다리 자리(body, arm_l, arm_r, leg_l, leg_r)뿐입니다.
      // 그 밖(얼굴 타원 밖 머리 쪽 = 헤어 자리, 맨몸 밖)에서는 살색 목록으로 버리지 않습니다.
      if (shouldStrip && skinColors && skinColors.length > 0) {
        const inEllipse = isInsideEllipse(x, y, cx, cy, rx, ry);
        const barePart = barePartMap ? barePartMap[destIdx] : null;
        const inBodyLimb = (barePart === 'body' || barePart === 'arm_l' || barePart === 'arm_r' || barePart === 'leg_l' || barePart === 'leg_r');

        if (inEllipse || inBodyLimb) {
          let isSkin = false;
          for (let i = 0; i < skinColors.length; i++) {
            const sc = skinColors[i];
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
        // 1. 얼굴 타원 안 = 표정 (eyes)
        if (isInsideEllipse(x, y, cx, cy, rx, ry)) {
          assignments[destIdx] = labelByPiece.eyes || 2;
          continue;
        }

        // 2. 발 쪽 = 신발 (shoe_l, shoe_r)
        if (y >= shoeMinY) {
          const shoePart = findNearestShoePart(x, y, partPixels);
          assignments[destIdx] = labelByPiece[shoePart] || 8;
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
        assignments[destIdx] = labelByPiece[part] || 3;
      } else if (kind === 'hair') {
        assignments[destIdx] = labelByPiece.hair || 1;
      } else if (kind === 'expression') {
        assignments[destIdx] = labelByPiece.eyes || 1;
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

  return {
    kind,
    width,
    height,
    assignments,
    offset: [ox, oy],
    stripBare: shouldStrip,
    faceEllipse: { cx, cy, rx, ry },
    skinColors,
    metas,
  };
}

/**
 * assignments 할당 결과 및 장식(decorations)으로부터 각 부위별 조각 이미지 버퍼를 추출합니다.
 */
export function extractPiecesFromAssignments({ image, assignments, kind, offset = [0, 0], decorations = [] }) {
  const width = image.width;
  const height = image.height;
  const [ox, oy] = offset;
  const metas = KIND_PIECES_META[kind] || KIND_PIECES_META.outfit;
  const result = [];

  // 장식으로 고른 칸들의 마스크 (장식 칸은 다른 부위 조각에서 빠집니다)
  const decoMask = new Uint8Array(width * height);
  for (const deco of decorations || []) {
    if (deco && deco.mask) {
      for (let i = 0; i < deco.mask.length; i++) {
        if (deco.mask[i]) decoMask[i] = 1;
      }
    }
  }

  for (const meta of metas) {
    const pieceData = new Uint8ClampedArray(width * height * 4);
    let pixelCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const destIdx = y * width + x;
        // 장식에 속한 칸은 다른 조각에서 제외
        if (decoMask[destIdx]) continue;

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

  // 등록된 장식(extra) 조각들을 추가
  for (const deco of decorations || []) {
    if (!deco || !deco.mask || !deco.name) continue;
    const pieceData = new Uint8ClampedArray(width * height * 4);
    let pixelCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const destIdx = y * width + x;
        if (deco.mask[destIdx]) {
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
        sourceKind: 'extra',
        piece: deco.name,
        name: `extra_${deco.name}`,
        pixelCount,
        image: { width, height, data: pieceData },
      });
    }
  }

  return result;
}
