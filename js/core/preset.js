// dotfactory-web/preset-1 순수 모듈 — 조각 그림, 부착 뼈, 렌더링 층(zIndex) 묶음을 다룹니다.
import { normalizeCanvas } from './skeleton.js';

export const SCHEMA = 'dotfactory-web/preset-1';

export const PRESET_KINDS = Object.freeze([
  'bare',
  'outfit',
  'face',
  'expression',
  'hair',
  'shoes',
  'sweat',
  'extra',
]);

function isValidId(id) {
  return typeof id === 'string' && /^[a-z0-9_]+$/.test(id);
}

export function normalizeLayers(layersRaw) {
  if (!Array.isArray(layersRaw)) throw new Error('프리셋 레이어 목록은 배열이어야 합니다');

  const ids = new Set();
  const result = [];

  for (let i = 0; i < layersRaw.length; i++) {
    const raw = layersRaw[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`레이어 #${i + 1} 자료가 올바르지 않습니다`);
    }

    const id = String(raw.id || '').trim();
    if (!id) throw new Error(`레이어 #${i + 1} 식별자가 비어 있습니다`);
    if (ids.has(id)) throw new Error(`레이어 식별자 「${id}」가 겹칩니다`);
    ids.add(id);

    const bone = String(raw.bone || '').trim();
    if (!bone) throw new Error(`레이어 「${id}」의 부착 뼈 이름이 비어 있습니다`);

    const zIndex = Number(raw.zIndex != null ? raw.zIndex : 0);
    if (!Number.isFinite(zIndex) || !Number.isInteger(zIndex) || zIndex < -1000 || zIndex > 1000) {
      throw new Error(`레이어 「${id}」의 zIndex(${raw.zIndex})는 -1000~1000 사이 정수여야 합니다`);
    }

    const slot = String(raw.slot || raw.piece || '').trim();
    const piece = String(raw.piece || raw.slot || '').trim();

    const image = String(raw.image || raw.png || '');
    if (!image.startsWith('data:image/png;base64,')) {
      throw new Error(`레이어 「${id}」의 그림이 올바른 Base64 PNG Data URL이 아닙니다`);
    }

    let pos = [0, 0];
    if (raw.pos != null) {
      if (!Array.isArray(raw.pos) || raw.pos.length !== 2) {
        throw new Error(`레이어 「${id}」의 pos는 정수 2개 배열이어야 합니다`);
      }
      const px = Number(raw.pos[0]);
      const py = Number(raw.pos[1]);
      if (!Number.isInteger(px) || !Number.isInteger(py)) {
        throw new Error(`레이어 「${id}」의 pos는 정수 2개 배열이어야 합니다`);
      }
      pos = [px, py];
    }

    let rot = 0;
    if (raw.rot != null) {
      const r = Number(raw.rot);
      if (!Number.isInteger(r)) {
        throw new Error(`레이어 「${id}」의 rot는 정수여야 합니다`);
      }
      rot = r;
    }

    const layer = {
      id,
      bone,
      zIndex,
      slot,
      piece,
      image,
    };
    if (pos[0] !== 0 || pos[1] !== 0) layer.pos = pos;
    if (rot !== 0) layer.rot = rot;

    result.push(layer);
  }

  return result;
}

export function toPreset({ id = 'preset', name = '새 프리셋', kind = 'bare', canvas = [72, 64], layers = [] } = {}) {
  const safeId = String(id || '').trim().toLowerCase();
  if (!isValidId(safeId)) {
    throw new Error(`프리셋 식별자 「${id}」는 영문 소문자, 숫자, 밑줄(_)만 쓸 수 있습니다`);
  }

  const safeName = String(name || '새 프리셋').trim();
  if (!safeName) throw new Error('프리셋 이름이 비어 있습니다');

  const safeKind = String(kind || 'bare').trim();
  if (!PRESET_KINDS.includes(safeKind)) {
    throw new Error(`프리셋 종류 「${safeKind}」는 허용된 목록(${PRESET_KINDS.join(', ')}) 중 하나여야 합니다`);
  }

  return {
    schema: SCHEMA,
    id: safeId,
    name: safeName,
    kind: safeKind,
    canvas: normalizeCanvas(canvas),
    layers: normalizeLayers(layers),
  };
}

export function parsePreset(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('프리셋 파일 자료가 깨졌습니다');
  if (json.schema !== SCHEMA) throw new Error('도트 공장 웹 프리셋 파일이 아닙니다');
  return toPreset({
    id: json.id,
    name: json.name,
    kind: json.kind,
    canvas: json.canvas,
    layers: json.layers,
  });
}

export function serializePreset(preset, space = 2) {
  return JSON.stringify(toPreset(preset), null, space);
}

export function deserializePreset(text) {
  if (typeof text !== 'string') throw new Error('프리셋 텍스트 자료가 올바르지 않습니다');
  return parsePreset(JSON.parse(text));
}

/** 프리셋을 고치지 않고, 붙는 뼈 이름이 현재 뼈대에 모두 있는지 검사합니다. */
export function checkPresetCompatibility(preset, targetBones) {
  const safePreset = parsePreset(preset);
  const targetNames = new Set(
    (Array.isArray(targetBones) ? targetBones : [])
      .map(bone => (typeof bone === 'string' ? bone : bone && bone.name))
      .filter(Boolean)
  );
  const missingBones = [...new Set(
    safePreset.layers.map(layer => layer.bone).filter(name => !targetNames.has(name))
  )];
  return {
    compatible: missingBones.length === 0,
    missingBones,
    warnings: missingBones.map(name => `뼈대에 없는 뼈 「${name}」에 붙는 그림은 표시할 수 없습니다`),
  };
}
