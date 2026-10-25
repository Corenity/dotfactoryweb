// 자르기 화면 되돌리기 / 다시하기 상태 관리 순수 모듈입니다.
// DOM을 쓰지 않아 Node 시험에서도 그대로 검증할 수 있습니다.
import { cloneRegionSliceState } from './region-slice.js';
import { currentCanvas } from './profile.js';

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
  const da = a.data;
  const db = b.data;
  if (da.length !== db.length) return false;
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) return false;
  }
  return true;
}

function clonePiece(p) {
  if (!p) return null;
  return {
    ...p,
    image: cloneImage(p.image),
  };
}

function samePieces(a, b) {
  if (a === b) return true;
  const aList = a || [];
  const bList = b || [];
  if (aList.length !== bList.length) return false;
  for (let i = 0; i < aList.length; i++) {
    const pa = aList[i];
    const pb = bList[i];
    if (pa.id !== pb.id || pa.name !== pb.name || pa.sourceKind !== pb.sourceKind || pa.color !== pb.color) {
      return false;
    }
    if (pa.png !== pb.png) return false;
    if (!sameImage(pa.image, pb.image)) return false;
  }
  return true;
}

function sameRegionSliceState(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.width !== b.width || a.height !== b.height) return false;
  if (a.regions.length !== b.regions.length) return false;
  for (let i = 0; i < a.regions.length; i++) {
    if (a.regions[i] !== b.regions[i]) return false;
  }
  const ga = a.grid;
  const gb = b.grid;
  if (ga.length !== gb.length) return false;
  for (let i = 0; i < ga.length; i++) {
    if (ga[i] !== gb[i]) return false;
  }
  return true;
}

export function cloneSliceState(state) {
  if (!state) return null;
  return {
    canvas: state.canvas ? [state.canvas[0], state.canvas[1]] : currentCanvas(),
    baseTitle: state.baseTitle || '그림',
    baseImage: cloneImage(state.baseImage),
    pieces: (state.pieces || []).map(clonePiece),
    regionState: state.regionState ? cloneRegionSliceState(state.regionState) : null,
    selectedColor: state.selectedColor ?? null,
  };
}

export function sameSliceState(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.canvas?.[0] !== b.canvas?.[0] || a.canvas?.[1] !== b.canvas?.[1]) return false;
  if (a.baseTitle !== b.baseTitle) return false;
  if (!sameImage(a.baseImage, b.baseImage)) return false;
  if (!samePieces(a.pieces, b.pieces)) return false;
  if (!sameRegionSliceState(a.regionState, b.regionState)) return false;
  return true;
}

export class SliceHistory {
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
    if (current !== undefined && sameSliceState(before, current)) {
      return false;
    }
    this.undoStack.push(cloneSliceState(before));
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    return true;
  }

  undo(current) {
    if (!this.undoStack.length) return null;
    this.redoStack.push(cloneSliceState(current));
    return this.undoStack.pop();
  }

  redo(current) {
    if (!this.redoStack.length) return null;
    this.undoStack.push(cloneSliceState(current));
    return this.redoStack.pop();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
