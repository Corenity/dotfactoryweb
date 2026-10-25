// 작업 화면의 preset-1 레이어/그룹 목록을 다루는 순수 모듈입니다.
// preset-1 공개 형식은 건드리지 않고, 작업 상태에만 key·visible을 둡니다.
import { parsePreset, toPreset } from './preset.js';
import { currentCanvas } from './profile.js';

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

/** 새 레이어/그룹 이름으로 식별자를 만들고, 이미 쓴 값이면 _2, _3을 붙입니다. */
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

/**
 * 화면 표시 시 그림이 보이는지 여부 판정 순수 함수
 * @param {object} piece
 * @param {Array} layers
 * @param {'individual'|'group'} visibilityMode
 * @returns {boolean}
 */
export function isPieceVisible(piece, layers = [], visibilityMode = 'individual') {
  if (!piece) return false;
  if (visibilityMode === 'group') {
    const layer = (layers || []).find(l => l.key === piece.presetLayerKey);
    // 그룹에 안 든 그림은 그룹 보기에서 늘 보임
    if (!layer) return true;
    return layer.visible !== false;
  }
  // individual (개별 보기): 그림의 개별 보이기 값만 봄
  return piece.visible !== false;
}

/**
 * 그림 정렬 규칙:
 * 1. 깊이(zIndex) 작은 번호가 먼저 깔림 (오름차순)
 * 2. 같은 번호면 나중에 읽은(넣은 · 불러온) 그림이 위 (pieces 배열의 나중 인덱스가 위)
 * 3. screen이 true일 때만 isPieceVisible 통과한 것만 필터링 (화면용). screen이 false면 전체 유지.
 */
export function sortRigPiecesByLayers(pieces = [], layers = [], { screen = false, visibilityMode = 'individual' } = {}) {
  return (pieces || []).map((piece, index) => ({ piece, index }))
    .filter(({ piece }) => (screen ? isPieceVisible(piece, layers, visibilityMode) : true))
    .sort((a, b) => {
      const zA = Number(a.piece?.zIndex) || 0, zB = Number(b.piece?.zIndex) || 0;
      if (zA !== zB) return zA - zB;
      return a.index - b.index;
    })
    .map(item => item.piece);
}

/**
 * 그룹의 보이기 상태 토글 (레이어 자체의 visible만 반전, pieces의 개별 visible은 절대 건드리지 않음)
 */
export function toggleGroupLayerVisibility(layers = [], layerKey) {
  return (layers || []).map(layer => {
    if (layer.key !== layerKey) return { ...layer };
    return { ...layer, visible: layer.visible === false ? true : false };
  });
}

/**
 * 옛 다중 레이어 파일/보관본을 열 때 기존 레이어 순서대로 그려지던 순서가 유지되도록
 * 각 레이어의 zIndex를 순차 오프셋으로 조정합니다.
 */
export function migrateLegacyLayersToDepth(layers = [], pieces = []) {
  if (!Array.isArray(layers) || layers.length <= 1) {
    return { layers: layers || [], pieces: pieces || [] };
  }
  let currentBase = null;
  const nextPieces = (pieces || []).map(p => ({ ...p }));
  for (const layer of layers) {
    const layerPieces = nextPieces.filter(p => p.presetLayerKey === layer.key);
    if (!layerPieces.length) continue;
    const minZ = Math.min(...layerPieces.map(p => Number(p.zIndex) || 0));
    const maxZ = Math.max(...layerPieces.map(p => Number(p.zIndex) || 0));
    if (currentBase === null) {
      currentBase = maxZ + 1;
    } else {
      const shift = currentBase - minZ;
      for (const p of layerPieces) {
        p.zIndex = (Number(p.zIndex) || 0) + shift;
      }
      currentBase = (maxZ + shift) + 1;
    }
  }
  return { layers, pieces: nextPieces };
}

/** 그룹 내 그림들의 보이기 상태: 'all' | 'none' | 'mixed' */
export function groupVisibilityState(layer, pieces = []) {
  const groupPieces = (pieces || []).filter(p => p?.presetLayerKey === layer?.key);
  if (!groupPieces.length) return 'all';
  const visibleCount = groupPieces.filter(p => p.visible !== false).length;
  if (visibleCount === groupPieces.length) return 'all';
  if (visibleCount === 0) return 'none';
  return 'mixed';
}

/** 그룹 보이기 단추: 모두 보임이면 전체 숨김, 아니면 전체 보임으로 일괄 맞춤 */
export function toggleGroupVisibility(layer, pieces = []) {
  const currentState = groupVisibilityState(layer, pieces);
  const nextVisible = currentState !== 'all';
  return (pieces || []).map(p => (p?.presetLayerKey === layer?.key ? { ...p, visible: nextVisible } : { ...p }));
}

/** 그룹 풀기: 그룹을 목록에서 삭제하고, 속해 있던 그림들의 presetLayerKey를 null로 초기화 */
export function ungroupRigPresetLayer(layers, pieces, layerKey) {
  const safeLayers = (layers || []).filter(l => l.key !== layerKey);
  const nextPieces = (pieces || []).map(p => (p.presetLayerKey === layerKey ? { ...p, presetLayerKey: null } : { ...p }));
  return { layers: safeLayers, pieces: nextPieces };
}

/** 그룹 편집: 그림 추가/빼기 */
export function updateGroupPieces(pieces, layerKey, { addPieceIds = [], removePieceIds = [] } = {}) {
  const addSet = new Set(addPieceIds);
  const removeSet = new Set(removePieceIds);
  return (pieces || []).map(p => {
    const id = p.id || p.name;
    if (addSet.has(id)) return { ...p, presetLayerKey: layerKey };
    if (removeSet.has(id)) return { ...p, presetLayerKey: null };
    return { ...p };
  });
}

export function rigLayerToPreset(layer, pieces = [], canvas = currentCanvas()) {
  if (!layer) throw new Error('저장할 프리셋 레이어를 골라 주세요');
  return toPreset({
    id: layer.id,
    name: layer.name,
    kind: layer.kind,
    canvas,
    layers: (pieces || []).filter(piece => piece?.presetLayerKey === layer.key).map(piece => {
      const item = {
        id: String(piece.name || `${piece.slot}_${piece.piece}`),
        bone: piece.bone,
        zIndex: piece.zIndex,
        slot: piece.slot,
        piece: piece.piece,
        image: piece.png,
      };
      if (piece.pos && (piece.pos[0] !== 0 || piece.pos[1] !== 0)) {
        item.pos = [Math.round(piece.pos[0]), Math.round(piece.pos[1])];
      }
      if (piece.rot) {
        item.rot = Math.round(piece.rot);
      }
      return item;
    }),
  });
}

export function groupDraftRigPieces(layers, pieces, meta, selectedPieceIds = null) {
  const safeLayers = normalizeRigPresetLayers(layers);
  const targetIds = selectedPieceIds ? new Set(selectedPieceIds) : null;
  const draftPieces = (pieces || []).filter(p => !p?.presetLayerKey && (!targetIds || targetIds.has(p.id || p.name)));
  if (!draftPieces.length) throw new Error('새 그룹에 넣을 그림을 골라 주세요');
  const layer = {
    key: nextPresetLayerKey(safeLayers),
    id: String(meta?.id || uniquePresetIdFromName(meta?.name || '새 프리셋', safeLayers)).trim().toLowerCase(),
    name: String(meta?.name || '새 프리셋').trim(),
    kind: String(meta?.kind || 'bare').trim(),
    visible: true,
  };
  const targetSet = new Set(draftPieces.map(p => p.id || p.name));
  const nextLayers = [...safeLayers, layer];
  const nextPieces = (pieces || []).map(p => {
    if (!p?.presetLayerKey && targetSet.has(p.id || p.name)) {
      return { ...p, presetLayerKey: layer.key };
    }
    return { ...p };
  });
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
    pos: item.pos ? [...item.pos] : [0, 0],
    rot: item.rot || 0,
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
