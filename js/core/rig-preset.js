// 뼈대 화면의 붙인 그림과 공개 preset-1 사이를 복사하는 순수 모듈입니다.
import { toPreset, parsePreset, checkPresetCompatibility } from './preset.js';

function safeLayerId(value, used) {
  const base = String(value || 'piece').toLowerCase()
    .replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'piece';
  let id = base, suffix = 2;
  while (used.has(id)) id = `${base}_${suffix++}`;
  used.add(id);
  return id;
}

export function nextRigZIndex(pieces) {
  const values = (Array.isArray(pieces) ? pieces : [])
    .map(piece => Number(piece?.zIndex)).filter(Number.isFinite);
  return values.length ? Math.max(...values) + 1 : 0;
}

/** 붙인 그림을 self-contained preset-1로 복사합니다. skeleton 필드는 만들지 않습니다. */
export function attachedPiecesToRigPreset({
  id = 'preset', name = '새 프리셋', kind = 'bare', canvas = [72, 64], pieces = [],
} = {}) {
  const used = new Set();
  const layers = (Array.isArray(pieces) ? pieces : []).map((piece, index) => {
    const layer = {
      id: safeLayerId(piece.presetLayerId || `${piece.slot || 'piece'}_${piece.piece || index + 1}`, used),
      bone: piece.bone,
      zIndex: piece.zIndex,
      slot: piece.slot || '',
      piece: piece.piece || piece.name || `piece_${index + 1}`,
      image: piece.png,
    };
    if (piece.pos && (piece.pos[0] !== 0 || piece.pos[1] !== 0)) {
      layer.pos = [Math.round(piece.pos[0]), Math.round(piece.pos[1])];
    }
    if (piece.rot) {
      layer.rot = Math.round(piece.rot);
    }
    return layer;
  });
  return toPreset({ id, name, kind, canvas, layers });
}

/** preset-1의 PNG와 없는 뼈 이름까지 새 붙인 그림 배열로 복사합니다. */
export function rigPresetToAttachedPieces(value) {
  const preset = value?.schema ? parsePreset(value) : toPreset(value);
  return preset.layers.map(layer => ({
    presetLayerId: layer.id,
    slot: layer.slot || preset.kind,
    item: preset.name,
    piece: layer.piece || layer.id,
    name: layer.piece || layer.id,
    bone: layer.bone,
    zIndex: layer.zIndex,
    pos: layer.pos ? [...layer.pos] : [0, 0],
    rot: layer.rot || 0,
    visible: true,
    png: layer.image,
  }));
}

/** 4판 캐릭터 화면도 같은 전수 대조 결과를 사용합니다. */
export function checkRigPresetBones(preset, bones) {
  return checkPresetCompatibility(preset, bones);
}
