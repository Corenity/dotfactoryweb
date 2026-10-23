// 이미지 자르기 조각 보관함의 순수 자료 함수입니다. DOM이나 저장소를 직접 쓰지 않습니다.
import { createStoredZip } from './zip.js';
import { defaultBoneFor, defaultZIndex } from './rig.js';

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 4096) {
    throw new Error(`${label}가 올바르지 않습니다`);
  }
  return number;
}

function safeId(value, fallback = 'piece') {
  const cleaned = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function uniqueId(base, used) {
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}_${suffix++}`;
  used.add(id);
  return id;
}

export function toSliceLibraryItem(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('자르기 조각 자료가 올바르지 않습니다');
  }
  const id = safeId(value.id, 'piece');
  const name = String(value.name || id).trim();
  if (!name) throw new Error('자르기 조각 이름이 비어 있습니다');
  const png = String(value.png || '');
  if (!png.startsWith('data:image/png')) throw new Error(`자르기 조각 「${name}」의 PNG가 깨졌습니다`);
  return {
    id,
    name,
    png,
    width: positiveInteger(value.width, '자르기 조각 너비'),
    height: positiveInteger(value.height, '자르기 조각 높이'),
    sourceKind: String(value.sourceKind || 'manual').trim() || 'manual',
    piece: String(value.piece || id).trim() || id,
  };
}

export function copyRigPiecesToSliceLibrary(pieces, canvas = [72, 64]) {
  if (!Array.isArray(pieces)) throw new Error('옛 조각 목록이 올바르지 않습니다');
  if (!Array.isArray(canvas) || canvas.length !== 2) throw new Error('옛 조각 그림판 크기가 올바르지 않습니다');
  const width = positiveInteger(canvas[0], '옛 조각 그림판 너비');
  const height = positiveInteger(canvas[1], '옛 조각 그림판 높이');
  const used = new Set();
  return pieces.map((piece, index) => {
    if (!piece || typeof piece !== 'object' || Array.isArray(piece)) {
      throw new Error(`${index + 1}번째 옛 조각이 올바르지 않습니다`);
    }
    const base = safeId(`${piece.slot || 'piece'}_${piece.piece || piece.name || index + 1}`);
    return toSliceLibraryItem({
      id: uniqueId(base, used),
      name: piece.name || piece.piece || `조각 ${index + 1}`,
      png: piece.png,
      width,
      height,
      sourceKind: piece.slot || 'manual',
      piece: piece.piece || base,
    });
  });
}

export function copySliceItemToPresetLayer(item, target = {}) {
  const source = toSliceLibraryItem(item);
  const id = String(target.id || source.id).trim();
  const bone = String(target.bone || '').trim();
  if (!id) throw new Error('프리셋 그림 식별자가 비어 있습니다');
  if (!bone) throw new Error(`프리셋 그림 「${id}」의 부착 뼈가 비어 있습니다`);
  const zIndex = Number(target.zIndex != null ? target.zIndex : 0);
  if (!Number.isInteger(zIndex) || zIndex < -1000 || zIndex > 1000) {
    throw new Error(`프리셋 그림 「${id}」의 층이 올바르지 않습니다`);
  }
  return {
    id,
    bone,
    zIndex,
    slot: String(target.slot || source.sourceKind || 'extra'),
    piece: String(target.piece || source.id),
    image: source.png,
  };
}

function pngBytes(dataUrl) {
  const match = /^data:image\/png(?:;[^,]*)?;base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) throw new Error('자르기 조각 PNG를 ZIP에 넣을 수 없습니다');
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeFileBase(value, fallback) {
  const clean = String(value || fallback).trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/[. ]+$/g, '');
  return clean || fallback;
}

/** 이름 붙은 투명 PNG 조각을 무압축 ZIP 하나로 묶습니다. */
export function makeSliceLibraryZip(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('내려받을 조각이 없습니다');
  const used = new Set();
  const entries = items.map((value, index) => {
    const item = toSliceLibraryItem(value);
    const base = safeFileBase(item.name, `조각_${index + 1}`);
    let name = `${base}.png`;
    let suffix = 2;
    while (used.has(name.toLowerCase())) name = `${base}_${suffix++}.png`;
    used.add(name.toLowerCase());
    return { name, data: pngBytes(item.png) };
  });
  return { bytes: createStoredZip(entries), entries: entries.map(entry => entry.name) };
}

/** 2판의 명시적 복사 경계입니다. 3판의 뼈대 「그림 넣기」도 같은 함수를 사용합니다. */
export function sliceLibraryItemToRigPiece(item, target = {}) {
  const source = toSliceLibraryItem(item);
  const slot = String(target.slot || (source.sourceKind === 'manual' ? 'extra' : source.sourceKind) || 'extra');
  const piece = String(target.piece || (slot === 'extra' ? source.id : source.piece) || source.id);
  const bone = defaultBoneFor(slot, piece, target.bones, target.selectedBone);
  const zIndex = target.zIndex != null ? Number(target.zIndex) : defaultZIndex(slot, piece);
  const layer = copySliceItemToPresetLayer(source, {
    id: String(target.id || source.id), bone, zIndex, slot, piece,
  });
  return {
    slot: layer.slot,
    item: String(target.item || source.name),
    piece: layer.piece,
    name: source.name,
    bone: layer.bone,
    zIndex: layer.zIndex,
    visible: true,
    png: layer.image,
  };
}
