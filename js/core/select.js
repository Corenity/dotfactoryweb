// 선택 — 다듬기에서 네모로 고른 칸을 떼어 한 덩어리로 옮깁니다. 화면(DOM)을 쓰지 않아 Node 시험이 그대로 돌립니다.
import { blank, clone } from './paint.js';

/** 두 칸을 마주 보는 꼭짓점으로 하는 네모를 그림판 안으로 자른 { x, y, w, h } 입니다. 그림판과 겹치지 않으면 null 입니다. */
export function selectRect([x0, y0], [x1, y1], width, height) {
  const left = Math.max(0, Math.min(x0, x1)), top = Math.max(0, Math.min(y0, y1));
  const right = Math.min(width - 1, Math.max(x0, x1)), bottom = Math.min(height - 1, Math.max(y0, y1));
  return right < left || bottom < top ? null : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

export function insideRect(rect, [x, y]) {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

/** 네모 안 칸을 떼어 냅니다. base 는 그 자리를 투명으로 비운 그림, piece 는 떼어 낸 칸만 담은 네모 크기 그림입니다. */
export function lift(img, rect) {
  const base = clone(img), piece = blank(rect.w, rect.h);
  for (let y = 0; y < rect.h; y++) {
    const s = ((rect.y + y) * img.width + rect.x) * 4, e = s + rect.w * 4;
    piece.data.set(img.data.subarray(s, e), y * rect.w * 4);
    base.data.fill(0, s, e);
  }
  return { base, piece };
}

/** 선택 조각의 모든 칸을 한 색으로 칠한 새 조각입니다. 투명색이면 색 값도 0으로 맞춥니다. */
export function fillPiece(piece, rgba) {
  const out = blank(piece.width, piece.height);
  const fill = rgba[3] === 0 ? [0, 0, 0, 0] : rgba;
  for (let i = 0; i < out.data.length; i += 4) out.data.set(fill, i);
  return out;
}

/** base 위 (x, y) 에 piece 를 얹은 새 그림입니다. piece 의 투명 칸은 아래를 가리지 않고, 그림판 밖으로 나간 칸은 그리지 않습니다. */
export function place(base, piece, x, y) {
  const out = clone(base);
  for (let py = 0; py < piece.height; py++) {
    const ty = y + py;
    if (ty < 0 || ty >= base.height) continue;
    for (let px = 0; px < piece.width; px++) {
      const tx = x + px, s = (py * piece.width + px) * 4;
      if (tx < 0 || tx >= base.width || !piece.data[s + 3]) continue;
      out.data.set(piece.data.subarray(s, s + 4), (ty * base.width + tx) * 4);
    }
  }
  return out;
}
