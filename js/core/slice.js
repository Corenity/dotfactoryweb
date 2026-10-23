// 조각 자르기 — 통짜 캐릭터 그림에서 고도 규격 부위 조각을 마스크로 선택하고 추출합니다.
// 화면(DOM)을 쓰지 않는 순수 모듈로 Node 시험이 그대로 돌립니다.

/**
 * 고도 엔진 character_parts.gd 의 SLOTS 와 100% 동일한 칸별 조각 정의입니다.
 */
export const SLOTS = {
  bare: ['torso', 'arm_l', 'arm_r', 'leg_l', 'leg_r', 'foot_l', 'foot_r'],
  face: ['face'],
  expression: ['brows', 'eyes', 'nose', 'mouth', 'cheek', 'fx'],
  sweat: ['sweat'],
  hair: ['hair'],
  outfit: ['body', 'arm_l', 'arm_r', 'leg_l', 'leg_r'],
  shoes: ['shoe_l', 'shoe_r'],
  hairpin: ['hairpin'],
  earring: ['earring'],
};

/** UI 표시용 한국어 친절 이름 표입니다. */
export const SLOT_NAMES = {
  bare: '맨몸',
  face: '얼굴틀',
  expression: '표정',
  sweat: '땀/기호',
  hair: '머리',
  outfit: '의상',
  shoes: '신발',
  hairpin: '머리핀',
  earring: '귀걸이',
};

export const PIECE_NAMES = {
  torso: '몸통',
  body: '상체',
  arm_l: '왼팔(화면 오른쪽)',
  arm_r: '오른팔(화면 왼쪽)',
  leg_l: '왼다리(화면 오른쪽)',
  leg_r: '오른다리(화면 왼쪽)',
  foot_l: '왼발(화면 오른쪽)',
  foot_r: '오른발(화면 왼쪽)',
  shoe_l: '왼신발(화면 오른쪽)',
  shoe_r: '오른신발(화면 왼쪽)',
  face: '얼굴틀',
  brows: '눈썹',
  eyes: '눈',
  nose: '코',
  mouth: '입',
  cheek: '볼/홍조',
  fx: '특수효과',
  sweat: '땀',
  hair: '머리카락',
  hairpin: '머리핀',
  earring: '귀걸이',
};

export function piecesOf(slot) {
  return SLOTS[slot] || [];
}

/** 너비×높이 크기의 0(미선택)으로 채워진 1바이트 마스크를 만듭니다. */
export function createMask(width, height) {
  return new Uint8Array(width * height);
}

/** 마스크의 모든 칸을 0으로 비웁니다. */
export function clearMask(mask) {
  mask.fill(0);
}

/** 마스크의 모든 칸을 1(선택)로 채웁니다. */
export function fillMask(mask) {
  mask.fill(1);
}

/** 사각형 영역 [x0, y0] ~ [x1, y1] 을 마스크에 설정합니다. value: 1(선택), 0(해제) */
export function setMaskRect(mask, width, height, [x0, y0], [x1, y1], value = 1) {
  const left = Math.max(0, Math.min(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const right = Math.min(width - 1, Math.max(x0, x1));
  const bottom = Math.min(height - 1, Math.max(y0, y1));
  if (right < left || bottom < top) return;
  const v = value ? 1 : 0;
  for (let y = top; y <= bottom; y++) {
    const s = y * width + left;
    mask.fill(v, s, s + (right - left + 1));
  }
}

/**
 * 점 (x, y) 가 points 다각형 안에 있는지 검사합니다(Ray Casting 알고리즘).
 * @param {[number, number][]} points [[x, y], ...]
 */
export function insidePolygon(points, x, y) {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * 올가미 다각형 내부를 마스크에 채웁니다.
 * points: [[x, y], ...]
 */
export function fillPolygonMask(mask, width, height, points, value = 1) {
  if (points.length < 3) return;
  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const left = Math.max(0, Math.floor(minX));
  const right = Math.min(width - 1, Math.ceil(maxX));
  const top = Math.max(0, Math.floor(minY));
  const bottom = Math.min(height - 1, Math.ceil(maxY));
  const v = value ? 1 : 0;

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (insidePolygon(points, x + 0.5, y + 0.5)) {
        mask[y * width + x] = v;
      }
    }
  }
}

/**
 * 붓/지우개로 (cx, cy) 중심 반경(size: 1, 2, 3)을 칠합니다.
 * size=1: 1×1 (cx, cy 한 칸)
 * size=2: 2×2
 * size=3: 3×3
 */
export function paintBrushMask(mask, width, height, cx, cy, size = 1, value = 1) {
  const v = value ? 1 : 0;
  const radius = Math.floor(size / 2);
  const left = Math.max(0, cx - radius);
  const right = Math.min(width - 1, cx + (size - 1 - radius));
  const top = Math.max(0, cy - radius);
  const bottom = Math.min(height - 1, cy + (size - 1 - radius));

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      mask[y * width + x] = v;
    }
  }
}

/** 마스크에 1(선택된 칸)이 하나라도 있는지 확인합니다. */
export function hasSelection(mask) {
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) return true;
  }
  return false;
}

/**
 * 원본 이미지에서 마스크가 1인 칸만 복사하여, 원본과 동일한 크기의 72×64 투명 PNG 버퍼를 만듭니다.
 * 마스크가 0인 칸은 [0, 0, 0, 0] 투명입니다.
 */
export function extractPiece(image, mask) {
  const out = new Uint8ClampedArray(image.width * image.height * 4);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const idx = y * image.width + x;
      if (mask[idx]) {
        const s = idx * 4;
        out[s] = image.data[s];
        out[s + 1] = image.data[s + 1];
        out[s + 2] = image.data[s + 2];
        out[s + 3] = image.data[s + 3];
      }
    }
  }
  return { width: image.width, height: image.height, data: out };
}

/** 조각에서 색이 칠해진(알파 > 0) 칸들의 최소/최대 좌표 범위를 계산합니다. */
export function pieceBounds(piece) {
  let minX = piece.width, maxX = -1, minY = piece.height, maxY = -1;
  for (let y = 0; y < piece.height; y++) {
    for (let x = 0; x < piece.width; x++) {
      const a = piece.data[(y * piece.width + x) * 4 + 3];
      if (a > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
