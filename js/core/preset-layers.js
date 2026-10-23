// 작업 화면의 preset-1 레이어 목록을 다루는 순수 모듈입니다.
// preset-1 공개 형식은 건드리지 않고, 작업 상태에만 key·visible을 둡니다.
import { parsePreset, toPreset } from './preset.js';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function cleanKey(value, fallback) {
  const key = String(value || '').trim();
  return key || fallback;
}

export function nextPresetLayerKey(layers = []) {
  const used = new Set((layers || []).map(layer => layer?.key));
  let number = 0;
  while (used.has(`preset_layer_${number}`)) number++;
  return `preset_layer_${number}`;
}

/** 새 레이어 이름으로 식별자를 만들고, 이미 쓴 값이면 _2, _3을 붙입니다. */
export function uniquePresetIdFromName(name, layers = [], tail = Date.now().toString(36).slice(-4)) {
  const raw = String(name || '').toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const safeTail = String(tail || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'new';
  const base = raw || `preset_${safeTail}`;
  const used = new Set((layers || []).map(layer => String(layer?.id || '').toLowerCase()));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

export function normalizeRigPresetLayers(value = []) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('프리셋 레이어 목록이 깨졌습니다');
  const used = new Set();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${index}번 프리셋 레이어가 깨졌습니다`);
    const key = cleanKey(raw.key, `preset_layer_${index}`);
    if (used.has(key)) throw new Error(`프리셋 레이어 키 「${key}」가 겹칩니다`);
    used.add(key);
    return {
      key,
      id: String(raw.id || 'preset').trim().toLowerCase(),
      name: String(raw.name || '새 프리셋').trim(),
      kind: String(raw.kind || 'bare').trim(),
      visible: raw.visible !== false,
    };
  });
}

export function normalizeRigLayerState(layers, pieces = []) {
  const safeLayers = normalizeRigPresetLayers(layers);
  const keys = new Set(safeLayers.map(layer => layer.key));
  return {
    layers: safeLayers,
    pieces: (pieces || []).map(piece => ({
      ...piece,
      presetLayerKey: keys.has(piece?.presetLayerKey) ? piece.presetLayerKey : null,
    })),
  };
}

export function rigLayerForPiece(piece, layers = []) {
  return (layers || []).find(layer => layer.key === piece?.presetLayerKey) || null;
}

export function sortRigPiecesByLayers(pieces = [], layers = []) {
  const safeLayers = normalizeRigPresetLayers(layers);
  const rank = new Map(safeLayers.map((layer, index) => [layer.key, index]));
  const visible = new Map(safeLayers.map(layer => [layer.key, layer.visible !== false]));
  return (pieces || []).map((piece, index) => ({ piece, index }))
    .filter(({ piece }) => piece?.visible !== false && visible.get(piece?.presetLayerKey) !== false)
    .sort((a, b) => {
      const layerA = rank.has(a.piece?.presetLayerKey) ? rank.get(a.piece.presetLayerKey) : safeLayers.length;
      const layerB = rank.has(b.piece?.presetLayerKey) ? rank.get(b.piece.presetLayerKey) : safeLayers.length;
      if (layerA !== layerB) return layerA - layerB;
      const zA = Number(a.piece?.zIndex) || 0, zB = Number(b.piece?.zIndex) || 0;
      return zA - zB || a.index - b.index;
    })
    .map(item => item.piece);
}

export function rigLayerToPreset(layer, pieces = [], canvas = [72, 64]) {
  if (!layer) throw new Error('저장할 프리셋 레이어를 골라 주세요');
  return toPreset({
    id: layer.id,
    name: layer.name,
    kind: layer.kind,
    canvas,
    layers: (pieces || []).filter(piece => piece?.presetLayerKey === layer.key).map(piece => ({
      id: String(piece.name || `${piece.slot}_${piece.piece}`),
      bone: piece.bone,
      zIndex: piece.zIndex,
      slot: piece.slot,
      piece: piece.piece,
      image: piece.png,
    })),
  });
}

export function groupDraftRigPieces(layers, pieces, meta) {
  const safeLayers = normalizeRigPresetLayers(layers);
  const draftCount = (pieces || []).filter(piece => !piece?.presetLayerKey).length;
  if (!draftCount) throw new Error('새 레이어에 저장할 그림이 없습니다');
  const layer = {
    key: nextPresetLayerKey(safeLayers),
    id: String(meta?.id || 'preset').trim().toLowerCase(),
    name: String(meta?.name || '새 프리셋').trim(),
    kind: String(meta?.kind || 'bare').trim(),
    visible: true,
  };
  const nextLayers = [...safeLayers, layer];
  const nextPieces = (pieces || []).map(piece => piece?.presetLayerKey ? { ...piece } : { ...piece, presetLayerKey: layer.key });
  return { layers: nextLayers, pieces: nextPieces, layer };
}

export function addPresetToRigLayers(layers, pieces, preset) {
  const safeLayers = normalizeRigPresetLayers(layers);
  const parsed = parsePreset(preset);
  const layer = {
    key: nextPresetLayerKey(safeLayers), id: parsed.id, name: parsed.name, kind: parsed.kind, visible: true,
  };
  const added = parsed.layers.map(item => ({
    slot: item.slot,
    item: parsed.name,
    piece: item.piece,
    name: item.id,
    bone: item.bone,
    zIndex: item.zIndex,
    visible: true,
    png: item.image,
    presetLayerKey: layer.key,
  }));
  return { layers: [...safeLayers, layer], pieces: [...(pieces || []).map(piece => ({ ...piece })), ...added], layer, added };
}

function characterEntry(raw, index) {
  const wrapped = raw?.preset ? raw : { preset: raw };
  return {
    key: cleanKey(wrapped.key, `character_layer_${index}`),
    visible: wrapped.visible !== false,
    source: String(wrapped.source || 'file'),
    sourceIndex: Number.isInteger(wrapped.sourceIndex) ? wrapped.sourceIndex : index,
    name: String(wrapped.name || wrapped.fileName || ''),
    preset: parsePreset(wrapped.preset),
  };
}

export function normalizeCharacterPresetLayers(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const raw = Array.isArray(input.presetLayers) ? input.presetLayers : null;
  const source = raw || [
    ...(input.barePreset ? [{ source: 'barePreset', preset: input.barePreset }] : []),
    ...(Array.isArray(input.loadedPresets) ? input.loadedPresets : []),
  ];
  const entries = source.map(characterEntry);
  const used = new Set();
  for (let index = 0; index < entries.length; index++) {
    let key = entries[index].key;
    if (used.has(key)) {
      let suffix = 2;
      while (used.has(`${key}_${suffix}`)) suffix++;
      key = `${key}_${suffix}`;
      entries[index].key = key;
    }
    used.add(key);
  }
  return entries;
}

export function characterLayersWithLegacyFields(layers = []) {
  const safe = normalizeCharacterPresetLayers({ presetLayers: layers });
  const bareIndex = safe.findIndex(entry => entry.preset.kind === 'bare');
  const barePreset = bareIndex >= 0 ? clone(safe[bareIndex].preset) : null;
  const loadedPresets = safe.filter((_, index) => index !== bareIndex).map((entry, index) => ({
    source: entry.source,
    sourceIndex: index,
    name: entry.name,
    preset: clone(entry.preset),
  }));
  return { presetLayers: clone(safe), barePreset, loadedPresets };
}
