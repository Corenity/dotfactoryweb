// 다듬기 — 칸 색 바꾸기 · 채우기 · 쓴 색 모으기 · 되돌리기 기록입니다. 화면과 떼어 둡니다.

export function blank(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function clone(img) {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

export function getPixel(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

/** 칸 하나를 [r,g,b,a] 로 칠합니다. 바뀌었으면 true 입니다. */
export function setPixel(img, x, y, rgba) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return false;
  const i = (y * img.width + x) * 4;
  const d = img.data;
  // 투명 칸은 색 값도 0 으로 맞춰 같은 투명을 같은 값으로 둡니다.
  const v = rgba[3] === 0 ? [0, 0, 0, 0] : rgba;
  if (d[i] === v[0] && d[i + 1] === v[1] && d[i + 2] === v[2] && d[i + 3] === v[3]) return false;
  d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = v[3];
  return true;
}

function sameColor(d, i, c) {
  if (c[3] === 0) return d[i + 3] === 0;
  return d[i] === c[0] && d[i + 1] === c[1] && d[i + 2] === c[2] && d[i + 3] === c[3];
}

/** 누른 칸과 같은 색으로 4방향 이어진 칸을 모두 칠합니다. 칠한 칸 수를 돌려줍니다. */
export function floodFill(img, x, y, rgba) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 0;
  const { width: w, height: h, data } = img;
  const target = getPixel(img, x, y);
  const fill = rgba[3] === 0 ? [0, 0, 0, 0] : rgba;
  if (sameColor(data, (y * w + x) * 4, fill)) return 0;
  const seen = new Uint8Array(w * h);
  const stack = [y * w + x];
  seen[y * w + x] = 1;
  let painted = 0;
  while (stack.length) {
    const p = stack.pop();
    const px = p % w, py = (p - px) / w;
    setPixel(img, px, py, fill);
    painted++;
    for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (!seen[q] && sameColor(data, q * 4, target)) { seen[q] = 1; stack.push(q); }
    }
  }
  return painted;
}

/** 이어졌는지와 상관없이 그림 전체에서 rgba 와 똑같은 칸을 모두 투명하게 합니다. 바꾼 칸 수를 돌려줍니다. */
export function clearColor(img, rgba) {
  if (rgba[3] === 0) return 0;
  let cleared = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (!sameColor(img.data, i, rgba)) continue;
    img.data.fill(0, i, i + 4);
    cleared++;
  }
  return cleared;
}

/** PC 도트 공장이 배경으로 까는 초록입니다. 세 화면 모두 이 초록을 배경으로 깔아 보여 줍니다. */
export const KEY = [3, 192, 55, 255];

/** 불러온 그림의 배경 초록 칸을 투명으로 바꾼 새 그림입니다. 화면 안의 그림은 늘 배경이 투명입니다. */
export function dropKey(img) {
  const out = clone(img);
  clearColor(out, KEY);
  return out;
}

/** 투명 칸을 배경 초록으로 채운 새 그림입니다. 초록 배경으로 내려받을 때 씁니다. */
export function fillKey(img) {
  const out = clone(img);
  for (let i = 0; i < out.data.length; i += 4) if (!out.data[i + 3]) out.data.set(KEY, i);
  return out;
}

/** 그림에 쓰인 불투명 색을 많이 쓴 순으로 돌려줍니다(#rrggbb). */
export function usedColors(img) {
  const counts = new Map();
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const hex = toHex([d[i], d[i + 1], d[i + 2]]);
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([hex]) => hex);
}

export function toHex(rgb) {
  return '#' + rgb.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255, 255];
}

/** 되돌리기 · 다시하기. 한 번의 붓질(손가락을 뗄 때까지)을 한 단계로 담습니다. */
export class History {
  constructor(limit = 100) { this.limit = limit; this.undoStack = []; this.redoStack = []; }
  /** 바꾸기 전 그림을 담습니다. */
  push(before) {
    this.undoStack.push(clone(before));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  undo(current) {
    if (!this.undoStack.length) return null;
    this.redoStack.push(clone(current));
    return this.undoStack.pop();
  }
  redo(current) {
    if (!this.redoStack.length) return null;
    this.undoStack.push(clone(current));
    return this.redoStack.pop();
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
