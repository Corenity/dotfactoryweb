// 재생 — 그림 여러 장을 한 판에 세우고 프레임 시간을 다룹니다. PC 도트 편집기의 프레임 목록과 같은 규칙입니다.

export const SCHEMA = 'dotfactory-web/play-1';

/** 새 그림의 처음 시간(ms)입니다. PC 도트 편집기와 같습니다. */
export const DEFAULT_MS = 130;
// GIF 는 시간을 1/100 초로 적어 10ms 단위만 담깁니다. 20ms 보다 짧으면 브라우저가 100ms 로 늘려 재생합니다.
export const MIN_MS = 20;
export const MAX_MS = 10000;

/** 프레임 시간을 20~10000ms 의 10ms 단위로 맞춥니다. 숫자가 아니면 처음 값입니다. */
export function frameMs(value) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(MAX_MS, Math.max(MIN_MS, Math.round(n / 10) * 10)) : DEFAULT_MS;
}

/** 모든 그림이 들어가는 판 크기 [너비, 높이] — 가장 넓은 너비와 가장 높은 높이입니다. */
export function stageSize(images) {
  if (!images.length) return [1, 1];
  return [Math.max(...images.map(i => i.width)), Math.max(...images.map(i => i.height))];
}

/** 그림을 width×height 판의 바닥 가운데에 세운 새 그림입니다. 캐릭터 발 자리가 프레임마다 같게 합니다. */
export function placeOnStage(image, width, height) {
  if (image.width === width && image.height === height) return image;
  const out = new Uint8ClampedArray(width * height * 4);
  const left = Math.floor((width - image.width) / 2), top = height - image.height;
  for (let y = 0; y < image.height; y++) {
    out.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((top + y) * width + left) * 4);
  }
  return { width, height, data: out };
}

/** 한 번에 고른 파일을 이름 순서로 놓습니다. 숫자는 크기대로(걷기2 가 걷기10 보다 앞) 비교합니다. */
export function byName(a, b) {
  return a.localeCompare(b, 'ko', { numeric: true });
}

/** 자동 보관용 — 프레임 순서 · 시간 · 그림(PNG data URL)과 재생 방식을 담습니다. */
export function toPlay(frames, loop) {
  return { schema: SCHEMA, loop: loop !== false, frames: frames.map(f => ({ name: f.name, ms: f.ms, png: f.png })) };
}

/** 자동 보관을 읽습니다. 그림이 깨진 프레임은 건너뜁니다. */
export function parsePlay(json) {
  if (!json || json.schema !== SCHEMA || !Array.isArray(json.frames)) throw new Error('도트 공장 웹 재생 자료가 아닙니다');
  return {
    loop: json.loop !== false,
    frames: json.frames
      .filter(f => typeof f?.png === 'string' && f.png.startsWith('data:image/png'))
      .map((f, n) => ({ name: String(f.name || `그림 ${n + 1}`), ms: frameMs(f.ms), png: f.png })),
  };
}
