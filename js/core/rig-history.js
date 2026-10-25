// 뼈대 화면 되돌리기 / 다시하기 상태 관리 순수 모듈입니다.
// DOM을 쓰지 않아 Node 시험에서도 그대로 검증할 수 있습니다.
import { CURRENT_PROFILE, currentCanvas } from './profile.js';

function cloneImage(img) {
  if (!img) return null;
  return {
    width: img.width,
    height: img.height,
    data: new Uint8ClampedArray(img.data),
  };
}

function sameImage(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.width !== b.width || a.height !== b.height) return false;
  const da = a.data, db = b.data;
  if (da.length !== db.length) return false;
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) return false;
  }
  return true;
}

export function cloneRigState(state) {
  if (!state) return null;
  return {
    canvas: state.canvas ? [state.canvas[0], state.canvas[1]] : currentCanvas(),
    baseTitle: state.baseTitle || '캐릭터',
    skeletonName: state.skeletonName || CURRENT_PROFILE.skeletonName,
    presetMeta: {
      id: state.presetMeta?.id || 'preset',
      name: state.presetMeta?.name || '새 프리셋',
      kind: state.presetMeta?.kind || 'bare',
    },
    presetLayers: (state.presetLayers || []).map(layer => ({ ...layer })),
    baseImage: cloneImage(state.baseImage),
    pieces: (state.pieces || []).map(p => ({
      ...p,
      pos: p.pos ? [p.pos[0], p.pos[1]] : [0, 0],
      rot: p.rot || 0,
      image: cloneImage(p.image),
    })),
    bones: (state.bones || []).map(b => ({
      ...b,
      pos: [...b.pos],
    })),
    animations: JSON.parse(JSON.stringify(state.animations || {})),
    restPose: state.restPose ? JSON.parse(JSON.stringify(state.restPose)) : null,
    visibilityMode: state.visibilityMode || 'individual',
  };
}

function stripPiecesForCompare(pieces) {
  return (pieces || []).map(p => ({
    slot: p.slot,
    item: p.item,
    piece: p.piece,
    name: p.name,
    bone: p.bone,
    zIndex: p.zIndex,
    pos: p.pos ? [p.pos[0], p.pos[1]] : [0, 0],
    rot: p.rot || 0,
    visible: p.visible,
    png: p.png,
    presetLayerKey: p.presetLayerKey || null,
  }));
}

export function sameRigState(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.canvas?.[0] !== b.canvas?.[0] || a.canvas?.[1] !== b.canvas?.[1]) return false;
  if (a.baseTitle !== b.baseTitle) return false;
  if (a.skeletonName !== b.skeletonName) return false;
  if (JSON.stringify(a.presetMeta || {}) !== JSON.stringify(b.presetMeta || {})) return false;
  if (JSON.stringify(a.presetLayers || []) !== JSON.stringify(b.presetLayers || [])) return false;
  if (!sameImage(a.baseImage, b.baseImage)) return false;

  const aPieces = a.pieces || [], bPieces = b.pieces || [];
  if (aPieces.length !== bPieces.length) return false;
  if (JSON.stringify(stripPiecesForCompare(aPieces)) !== JSON.stringify(stripPiecesForCompare(bPieces))) return false;
  for (let i = 0; i < aPieces.length; i++) {
    if (!sameImage(aPieces[i].image, bPieces[i].image)) return false;
  }

  if (JSON.stringify(a.bones || []) !== JSON.stringify(b.bones || [])) return false;
  if (JSON.stringify(a.animations || {}) !== JSON.stringify(b.animations || {})) return false;
  if (JSON.stringify(a.restPose || null) !== JSON.stringify(b.restPose || null)) return false;
  if ((a.visibilityMode || 'individual') !== (b.visibilityMode || 'individual')) return false;

  return true;
}

export class RigHistory {
  constructor(limit = 100) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  push(before, current) {
    if (current !== undefined && sameRigState(before, current)) {
      return false;
    }
    this.undoStack.push(cloneRigState(before));
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    return true;
  }

  undo(current) {
    if (!this.undoStack.length) return null;
    this.redoStack.push(cloneRigState(current));
    return this.undoStack.pop();
  }

  redo(current) {
    if (!this.redoStack.length) return null;
    this.undoStack.push(cloneRigState(current));
    return this.redoStack.pop();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
