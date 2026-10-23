// 브라우저와 Node에서 함께 쓰는 무압축 ZIP(stored) 생성·읽기입니다.
// 외부 패키지나 DOM을 쓰지 않습니다.

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_ENTRIES = 1000;
const MAX_TOTAL = 256 * 1024 * 1024;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

export function bytesFromText(text) {
  return encoder.encode(String(text));
}

export function textFromBytes(bytes) {
  try {
    return decoder.decode(asBytes(bytes));
  } catch {
    throw new Error('ZIP 안의 글 파일이 UTF-8 형식이 아닙니다');
  }
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of asBytes(bytes)) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('ZIP에 넣을 자료가 바이트 배열이 아닙니다');
}

function safeName(value) {
  const name = String(value).replaceAll('\\', '/').replace(/^\/+/, '');
  if (!name || name.includes('\0') || name.split('/').includes('..')) throw new Error(`ZIP 경로 「${name || value}」가 올바르지 않습니다`);
  return name;
}

function set16(view, offset, value) { view.setUint16(offset, value, true); }
function set32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
function get16(view, offset) { return view.getUint16(offset, true); }
function get32(view, offset) { return view.getUint32(offset, true); }

function joinBytes(parts, size) {
  const result = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}

/** entries: [{ name, data: string|Uint8Array }]. */
export function createStoredZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('ZIP에 넣을 파일이 없습니다');
  if (entries.length > MAX_ENTRIES) throw new Error(`ZIP 파일 수는 ${MAX_ENTRIES}개를 넘을 수 없습니다`);

  const seen = new Set(), localParts = [], centralParts = [];
  let localSize = 0, centralSize = 0, totalData = 0;
  for (const entry of entries) {
    const name = safeName(entry?.name);
    if (seen.has(name)) throw new Error(`ZIP 경로 「${name}」가 둘 이상입니다`);
    seen.add(name);
    const nameBytes = bytesFromText(name);
    const data = typeof entry.data === 'string' ? bytesFromText(entry.data) : asBytes(entry.data);
    totalData += data.length;
    if (totalData > MAX_TOTAL) throw new Error('ZIP 안의 파일 크기가 너무 큽니다');
    const crc = crc32(data), localOffset = localSize;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    set32(lv, 0, 0x04034b50); set16(lv, 4, 20); set16(lv, 6, 0x0800); set16(lv, 8, 0);
    set16(lv, 10, 0); set16(lv, 12, 0x0021); set32(lv, 14, crc); set32(lv, 18, data.length); set32(lv, 22, data.length);
    set16(lv, 26, nameBytes.length); set16(lv, 28, 0); local.set(nameBytes, 30);
    localParts.push(local, data);
    localSize += local.length + data.length;

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    set32(cv, 0, 0x02014b50); set16(cv, 4, 20); set16(cv, 6, 20); set16(cv, 8, 0x0800); set16(cv, 10, 0);
    set16(cv, 12, 0); set16(cv, 14, 0x0021); set32(cv, 16, crc); set32(cv, 20, data.length); set32(cv, 24, data.length);
    set16(cv, 28, nameBytes.length); set16(cv, 30, 0); set16(cv, 32, 0); set16(cv, 34, 0); set16(cv, 36, 0);
    set32(cv, 38, 0); set32(cv, 42, localOffset); central.set(nameBytes, 46);
    centralParts.push(central);
    centralSize += central.length;
  }

  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  set32(ev, 0, 0x06054b50); set16(ev, 4, 0); set16(ev, 6, 0);
  set16(ev, 8, entries.length); set16(ev, 10, entries.length);
  set32(ev, 12, centralSize); set32(ev, 16, localSize); set16(ev, 20, 0);
  return joinBytes([...localParts, ...centralParts, end], localSize + centralSize + end.length);
}

function findEnd(bytes) {
  const start = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= start; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
  }
  throw new Error('ZIP의 끝 정보를 찾을 수 없습니다');
}

/** Map<경로, Uint8Array>를 돌려줍니다. 무압축 ZIP만 읽습니다. */
export function readStoredZip(input) {
  const bytes = asBytes(input), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endAt = findEnd(bytes);
  if (endAt + 22 > bytes.length) throw new Error('ZIP 끝 정보가 잘렸습니다');
  const count = get16(view, endAt + 10), centralSize = get32(view, endAt + 12), centralAt = get32(view, endAt + 16);
  if (count > MAX_ENTRIES) throw new Error(`ZIP 파일 수는 ${MAX_ENTRIES}개를 넘을 수 없습니다`);
  if (centralAt + centralSize > endAt) throw new Error('ZIP 파일 목록이 잘렸습니다');

  const result = new Map();
  let at = centralAt, total = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > bytes.length || get32(view, at) !== 0x02014b50) throw new Error('ZIP 파일 목록이 깨졌습니다');
    const flags = get16(view, at + 8), method = get16(view, at + 10), expectedCrc = get32(view, at + 16);
    const packedSize = get32(view, at + 20), size = get32(view, at + 24);
    const nameLength = get16(view, at + 28), extraLength = get16(view, at + 30), commentLength = get16(view, at + 32);
    const localAt = get32(view, at + 42), nameAt = at + 46, next = nameAt + nameLength + extraLength + commentLength;
    if (next > bytes.length) throw new Error('ZIP 파일 이름이 잘렸습니다');
    const name = safeName(textFromBytes(bytes.subarray(nameAt, nameAt + nameLength)));
    if ((flags & 0x0001) !== 0) throw new Error('암호가 걸린 ZIP은 읽을 수 없습니다');
    if (method !== 0) throw new Error('압축 안 된 ZIP만 읽습니다');
    if (packedSize !== size) throw new Error(`ZIP 파일 「${name}」의 크기가 올바르지 않습니다`);
    if (localAt + 30 > bytes.length || get32(view, localAt) !== 0x04034b50) throw new Error(`ZIP 파일 「${name}」의 시작 정보가 깨졌습니다`);
    const localNameLength = get16(view, localAt + 26), localExtraLength = get16(view, localAt + 28);
    const dataAt = localAt + 30 + localNameLength + localExtraLength, dataEnd = dataAt + size;
    if (dataEnd > bytes.length) throw new Error(`ZIP 파일 「${name}」이 잘렸습니다`);
    total += size;
    if (total > MAX_TOTAL) throw new Error('ZIP 안의 파일 크기가 너무 큽니다');
    const data = bytes.slice(dataAt, dataEnd);
    if (crc32(data) !== expectedCrc) throw new Error(`ZIP 파일 「${name}」의 내용 검사가 맞지 않습니다`);
    if (result.has(name)) throw new Error(`ZIP 경로 「${name}」가 둘 이상입니다`);
    if (!name.endsWith('/')) result.set(name, data);
    at = next;
  }
  return result;
}
