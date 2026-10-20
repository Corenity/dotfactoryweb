// 합치기 — 그림 여러 장을 층 번호 순서로 겹칩니다. PC 조립(df_assemble.stack)과 같은 규칙입니다.
// 층 번호가 큰 그림이 위에 옵니다. 알파가 0 보다 큰 칸은 아래 칸을 그대로 덮습니다(섞지 않음).

export const SCHEMA = 'dotfactory-web/assemble-1';

/**
 * @param {{ image: {width:number,height:number,data:Uint8ClampedArray}, layer: number, visible: boolean, dx: number, dy: number }[]} items
 */
export function compose(items, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  // 같은 층 번호면 목록에서 뒤에 있는 것이 위입니다.
  const order = items.map((item, index) => ({ item, index }))
    .filter(({ item }) => item.visible !== false)
    .sort((a, b) => a.item.layer - b.item.layer || a.index - b.index);
  for (const { item } of order) {
    const { image, dx = 0, dy = 0 } = item;
    for (let y = 0; y < image.height; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= height) continue;
      for (let x = 0; x < image.width; x++) {
        const tx = x + dx;
        if (tx < 0 || tx >= width) continue;
        const s = (y * image.width + x) * 4;
        if (!image.data[s + 3]) continue;
        const d = (ty * width + tx) * 4;
        out[d] = image.data[s]; out[d + 1] = image.data[s + 1]; out[d + 2] = image.data[s + 2]; out[d + 3] = image.data[s + 3];
      }
    }
  }
  return { width, height, data: out };
}

/** 그림판 크기는 가장 큰 그림에 맞춥니다(보통 72×64). */
export function canvasSizeFor(items) {
  let w = 0, h = 0;
  for (const { image } of items) { w = Math.max(w, image.width); h = Math.max(h, image.height); }
  return [w || 72, h || 64];
}

/** 새 그림의 층 번호 — 지금 가장 위보다 10 큰 수입니다. */
export function nextLayer(items) {
  return items.length ? Math.max(...items.map(i => i.layer)) + 10 : 10;
}

/** 저장 파일(JSON) 내용입니다. 그림은 PNG data URL 로 같이 담아 파일 하나로 다시 열 수 있습니다. */
export function toProject(items, width, height, pngOf) {
  return {
    schema: SCHEMA,
    canvas: [width, height],
    items: items.map(i => ({ name: i.name, layer: i.layer, visible: i.visible !== false, dx: i.dx || 0, dy: i.dy || 0, png: pngOf(i.image) })),
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
      return { name: String(i.name || `그림 ${n + 1}`), layer: Number(i.layer) || 0, visible: i.visible !== false,
        dx: Math.trunc(Number(i.dx) || 0), dy: Math.trunc(Number(i.dy) || 0), png: i.png };
    }),
  };
}
