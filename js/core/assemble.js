// 합치기 — 그림 여러 장을 층 번호 순서로 겹칩니다. PC 조립(df_assemble.stack)과 같은 규칙입니다.
// 층 번호가 큰 그림이 위에 옵니다. 알파가 0 보다 큰 칸은 아래 칸을 그대로 덮습니다(섞지 않음).
// 그림마다 진하기(opacity)가 있지만 화면에서 볼 때만(fade) 비치고, 내려받는 그림은 늘 100% 로 겹칩니다.

export const SCHEMA = 'dotfactory-web/assemble-1';

/**
 * @param {{ image: {width:number,height:number,data:Uint8ClampedArray}, layer: number, visible: boolean, dx: number, dy: number, opacity?: number }[]} items
 * @param {{ fade?: boolean }} [options] fade 이면 진하기가 1 보다 작은 그림을 아래 칸과 섞어 비치게 합니다(화면 전용).
 */
export function compose(items, width, height, { fade = false } = {}) {
  const out = new Uint8ClampedArray(width * height * 4);
  // 같은 층 번호면 목록에서 뒤에 있는 것이 위입니다.
  const order = items.map((item, index) => ({ item, index }))
    .filter(({ item }) => item.visible !== false)
    .sort((a, b) => a.item.layer - b.item.layer || a.index - b.index);
  for (const { item } of order) {
    const { image, dx = 0, dy = 0 } = item;
    const alpha = fade ? layerOpacity(item.opacity) : 1;
    if (!alpha) continue;
    for (let y = 0; y < image.height; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= height) continue;
      for (let x = 0; x < image.width; x++) {
        const tx = x + dx;
        if (tx < 0 || tx >= width) continue;
        const s = (y * image.width + x) * 4;
        if (!image.data[s + 3]) continue;
        const d = (ty * width + tx) * 4;
        if (alpha < 1) { blendOver(out, d, image.data, s, image.data[s + 3] / 255 * alpha); continue; }
        out[d] = image.data[s]; out[d + 1] = image.data[s + 1]; out[d + 2] = image.data[s + 2]; out[d + 3] = image.data[s + 3];
      }
    }
  }
  return { width, height, data: out };
}

/** 대볼 그림 진하기의 처음 값입니다. 0 이면 안 보이고 1 이면 아래 칸을 다 덮습니다. */
export const GUIDE_OPACITY = 0.5;

/** 진하기를 0~1 의 0.1 단위로 맞춥니다. 값이 없거나 숫자가 아니면(옛 파일) 처음 값입니다. */
export function guideOpacity(value) {
  return roundOpacity(value, GUIDE_OPACITY);
}

/** 그림(레이어) 진하기 — 대볼 그림과 같은 0~1 의 0.1 단위이고, 값이 없는 옛 파일 · 새 그림은 1(다 보임)입니다. */
export function layerOpacity(value) {
  return roundOpacity(value, 1);
}

function roundOpacity(value, fallback) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 10) / 10 : fallback;
}

/** out 의 d 칸 위에 src 의 s 칸을 진하기 ga(0~1)만큼 얹습니다. 아래 칸은 나머지만큼 비칩니다. */
function blendOver(out, d, src, s, ga) {
  if (!ga) return;
  const ua = out[d + 3] / 255 * (1 - ga);
  const a = ga + ua;
  for (let c = 0; c < 3; c++) out[d + c] = Math.round((src[s + c] * ga + out[d + c] * ua) / a);
  out[d + 3] = Math.round(a * 255);
}

/**
 * 대볼 그림을 합친 그림 맨 위에 비치게 얹은 새 그림입니다. 화면에서 맞춰 볼 때만 쓰고 저장에는 넣지 않습니다.
 * 대볼 그림의 칸은 alpha(0~1, 진하기) 만큼만 덮고, 아래 칸은 나머지만큼 비칩니다.
 */
export function overlayGuide(base, guide, alpha = GUIDE_OPACITY, dx = 0, dy = 0) {
  const out = new Uint8ClampedArray(base.data);
  for (let y = 0; y < guide.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= base.height) continue;
    for (let x = 0; x < guide.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= base.width) continue;
      const s = (y * guide.width + x) * 4;
      blendOver(out, (ty * base.width + tx) * 4, guide.data, s, guide.data[s + 3] / 255 * alpha);
    }
  }
  return { width: base.width, height: base.height, data: out };
}

/** 그림판 크기는 가장 큰 그림에 맞춥니다(보통 72×64). */
export function canvasSizeFor(items) {
  let w = 0, h = 0;
  for (const { image } of items) { w = Math.max(w, image.width); h = Math.max(h, image.height); }
  return [w || 72, h || 64];
}

/** 층 번호의 가장 작은 값입니다. 첫 그림이 이 층에 들어가고, 내리기 · 직접 쓰기도 이 아래로 가지 않습니다. */
export const MIN_LAYER = 1;

/** 층 번호를 MIN_LAYER 이상의 정수로 맞춥니다. 숫자가 아니면 MIN_LAYER 입니다. */
export function clampLayer(value) {
  return Math.max(MIN_LAYER, Math.trunc(Number(value) || 0));
}

/** 새 그림의 층 번호 — 지금 가장 위보다 1 큰 수입니다. */
export function nextLayer(items) {
  return items.length ? Math.max(...items.map(i => i.layer)) + 1 : MIN_LAYER;
}

/** 저장 파일(JSON) 내용입니다. 그림은 PNG data URL 로 같이 담아 파일 하나로 다시 열 수 있습니다. */
// 대볼 그림(guide)은 조립할 부위(items)와 따로 담습니다. 읽는 쪽이 부위로 오해하지 않게 하려는 것입니다.
export function toProject(items, width, height, pngOf, guide = null) {
  return {
    schema: SCHEMA,
    canvas: [width, height],
    // opacity 는 화면에서 비쳐 보이는 정도입니다. 내려받은 합친 그림에는 들어가지 않고, 고도에서 조립할 때 읽어 쓸 수 있게 담아 둡니다.
    items: items.map(i => ({ name: i.name, layer: i.layer, visible: i.visible !== false, dx: i.dx || 0, dy: i.dy || 0,
      opacity: layerOpacity(i.opacity), png: pngOf(i.image) })),
    ...(guide ? { guide: { name: guide.name, visible: guide.visible !== false, opacity: guideOpacity(guide.opacity), png: pngOf(guide.image) } } : {}),
  };
}

/** 저장 파일을 검사하고 그림 항목 목록(그림은 아직 data URL)으로 돌려줍니다. */
export function parseProject(json) {
  if (!json || json.schema !== SCHEMA || !Array.isArray(json.items)) throw new Error('도트 공장 웹 합치기 파일이 아닙니다');
  const [w, h] = Array.isArray(json.canvas) ? json.canvas : [72, 64];
  return {
    canvas: [w, h],
    items: json.items.map((i, n) => {
      if (typeof i.png !== 'string' || !i.png.startsWith('data:image/png')) throw new Error(`${n + 1}번째 그림이 없습니다`);
      return { name: String(i.name || `그림 ${n + 1}`), layer: clampLayer(i.layer), visible: i.visible !== false,
        dx: Math.trunc(Number(i.dx) || 0), dy: Math.trunc(Number(i.dy) || 0), opacity: layerOpacity(i.opacity), png: i.png };
    }),
    // 대볼 그림이 없거나 그림이 깨진 옛 파일은 대볼 그림 없이 엽니다.
    guide: typeof json.guide?.png === 'string' && json.guide.png.startsWith('data:image/png')
      ? { name: String(json.guide.name || '대볼 그림'), visible: true,
        opacity: json.guide.visible === false ? 0 : guideOpacity(json.guide.opacity), png: json.guide.png }
      : null,
  };
}
