// 움직이는 GIF 만들기 — 같은 크기의 그림 여러 장을 프레임 시간대로 이어 GIF89a 바이트로 만듭니다.
// GIF 색표 하나에는 색이 256개(투명 1 + 색 255)까지만 들어갑니다. 도트 그림은 대개 그 안이라 모든 프레임이 한 색표를 같이 쓰고,
// 모두 합쳐 넘으면 프레임마다 자기 색표를 둡니다. 한 프레임만으로도 넘으면 많이 쓴 255색을 남기고 나머지 칸은 가장 가까운 색으로 칠합니다.
// 투명은 켜고 끄기만 있어 알파 128 미만은 투명, 그 이상은 불투명으로 담습니다.

const TRANSPARENT = 0;
const MAX_COLORS = 255;

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray}[]} frames 크기가 모두 같은 그림
 * @param {number[]} delays 프레임마다 보여 줄 시간(ms) — 10ms 단위로 반올림해 담습니다
 * @param {{ loop?: boolean }} options loop 가 false 면 한 번만 재생합니다
 * @returns {Uint8Array}
 */
export function encodeGif(frames, delays, { loop = true } = {}) {
  if (!frames.length) throw new Error('프레임이 없습니다');
  const { width, height } = frames[0];
  if (frames.some(f => f.width !== width || f.height !== height)) throw new Error('프레임 크기가 서로 다릅니다');
  const shared = buildPalette(frames);
  const local = shared.complete ? null : frames.map(f => buildPalette([f]));
  const global = local ? { colors: [], bits: 1 } : shared;

  const out = new ByteWriter();
  out.ascii('GIF89a');
  out.u16(width); out.u16(height);
  out.byte(0x80 | ((global.bits - 1) << 4) | (global.bits - 1)); // 전체 색표 있음 · 색 깊이 · 색표 크기
  out.byte(TRANSPARENT); out.byte(0);
  writeTable(out, global);
  if (loop) { // 끝없이 되풀이 (NETSCAPE2.0, 반복 횟수 0)
    out.byte(0x21); out.byte(0xff); out.byte(11); out.ascii('NETSCAPE2.0');
    out.byte(3); out.byte(1); out.u16(0); out.byte(0);
  }
  frames.forEach((frame, n) => {
    const palette = local ? local[n] : shared;
    // 다음 프레임 전에 이 프레임을 지워(처리 방식 2) 투명 칸에 앞 프레임이 남지 않게 합니다.
    out.byte(0x21); out.byte(0xf9); out.byte(4); out.byte((2 << 2) | 1);
    out.u16(Math.max(0, Math.round((delays[n] ?? 100) / 10))); out.byte(TRANSPARENT); out.byte(0);
    out.byte(0x2c); out.u16(0); out.u16(0); out.u16(width); out.u16(height);
    if (local) { out.byte(0x80 | (palette.bits - 1)); writeTable(out, palette); } else out.byte(0);
    const minCode = Math.max(2, palette.bits);
    out.byte(minCode);
    const data = lzw(indicesOf(frame, palette.indexOf), minCode);
    for (let i = 0; i < data.length; i += 255) {
      const block = data.subarray(i, i + 255);
      out.byte(block.length); out.bytes(block);
    }
    out.byte(0);
  });
  out.byte(0x3b);
  return out.done();
}

/** 색표 — 0번은 투명, 그 뒤로 색을 적고 2 의 거듭제곱 크기까지 검정으로 채웁니다. */
function writeTable(out, { colors, bits }) {
  for (let i = 0; i < 1 << bits; i++) {
    const c = i === TRANSPARENT ? 0 : colors[i - 1] ?? 0;
    out.byte((c >> 16) & 255); out.byte((c >> 8) & 255); out.byte(c & 255);
  }
}

/**
 * 쓴 색을 많이 쓴 순서로 255개까지 고릅니다. complete 는 모든 색이 들어갔는지, bits 는 색표 크기(2^bits)이고,
 * indexOf 는 칸 색 → 색표 번호입니다.
 */
function buildPalette(frames) {
  const counts = new Map();
  for (const { data } of frames) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      counts.set(c, (counts.get(c) || 0) + 1);
    }
  }
  const complete = counts.size <= MAX_COLORS;
  const colors = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, MAX_COLORS).map(e => e[0]);
  let bits = 1;
  while ((1 << bits) < colors.length + 1) bits++;
  const index = new Map(colors.map((c, i) => [c, i + 1]));
  const indexOf = c => {
    let found = index.get(c);
    if (found === undefined) { found = nearest(colors, c) + 1; index.set(c, found); }
    return found;
  };
  return { colors, bits, complete, indexOf };
}

function nearest(colors, c) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  let best = 0, bestDist = Infinity;
  colors.forEach((p, i) => {
    const dr = ((p >> 16) & 255) - r, dg = ((p >> 8) & 255) - g, db = (p & 255) - b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) { bestDist = dist; best = i; }
  });
  return best;
}

function indicesOf({ data }, indexOf) {
  const out = new Uint8Array(data.length / 4);
  for (let p = 0, i = 0; i < data.length; p++, i += 4) {
    out[p] = data[i + 3] < 128 ? TRANSPARENT : indexOf((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  }
  return out;
}

/** GIF 의 LZW 압축 — 부호 길이는 표가 찰 때마다 한 비트씩(최대 12비트) 늘고, 4096개가 차면 표를 비웁니다. */
function lzw(indices, minCode) {
  const clear = 1 << minCode, end = clear + 1;
  let size = minCode + 1, next = end + 1, table = new Map();
  const out = [];
  let acc = 0, accBits = 0;
  const emit = code => {
    acc |= code << accBits; accBits += size;
    while (accBits >= 8) { out.push(acc & 255); acc >>>= 8; accBits -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 256 + k;
    const found = table.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) {
      if (next >= 1 << size) size++;
      table.set(key, next++);
    } else {
      emit(clear);
      table = new Map(); size = minCode + 1; next = end + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (accBits > 0) out.push(acc & 255);
  return Uint8Array.from(out);
}

class ByteWriter {
  constructor() { this.buf = new Uint8Array(4096); this.len = 0; }
  grow(n) {
    if (this.len + n <= this.buf.length) return;
    const bigger = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    bigger.set(this.buf.subarray(0, this.len)); this.buf = bigger;
  }
  byte(v) { this.grow(1); this.buf[this.len++] = v; }
  u16(v) { this.byte(v & 255); this.byte((v >> 8) & 255); }
  ascii(s) { for (const ch of s) this.byte(ch.charCodeAt(0)); }
  bytes(arr) { this.grow(arr.length); this.buf.set(arr, this.len); this.len += arr.length; }
  done() { return this.buf.slice(0, this.len); }
}
