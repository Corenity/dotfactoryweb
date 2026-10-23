// 이미지 자르기 화면 — 원본·선택 마스크·조각 보관함을 뼈대와 독립해 소유합니다.
import { createMask } from './core/slice.js';
import { dropKey } from './core/paint.js';
import { toSliceLibraryItem } from './core/slice-library.js';
import { RigHistory, cloneRigState } from './core/rig-history.js';
import { pickFiles, readImageFile, readDataUrl, toPngDataUrl, baseName } from './io.js';
import { mountRigSlice } from './rig-slice-view.js';
import { mountSliceLibrary } from './slice-library-view.js';

const $ = sel => document.querySelector(sel);

export function mountSlice(app) {
  let baseImage = null;
  let baseTitle = '그림';
  let width = 72, height = 64;
  let mask = createMask(width, height);
  let pieces = [];
  const history = new RigHistory();
  const undoButton = $('#slice-undo');
  const redoButton = $('#slice-redo');
  let canvasView, libraryView;

  function historySnapshot() {
    return cloneRigState({
      canvas: [width, height], baseTitle, baseImage, pieces,
      bones: [], animations: {}, restPose: null,
    });
  }

  function updateUndoRedo() {
    undoButton.disabled = !history.canUndo;
    redoButton.disabled = !history.canRedo;
  }

  function syncViews() {
    canvasView.sync();
    libraryView.sync();
    libraryView.render();
    canvasView.render();
    updateUndoRedo();
  }

  function recordChange(before) {
    if (history.push(before, historySnapshot())) {
      updateUndoRedo();
      app.changed();
    }
  }

  function applyHistory(value) {
    if (!value) return;
    const state = cloneRigState(value);
    [width, height] = state.canvas;
    baseTitle = state.baseTitle;
    baseImage = state.baseImage;
    pieces = state.pieces;
    mask = createMask(width, height);
    syncViews();
    app.changed();
  }

  function setBaseImage(image, title = '그림') {
    baseImage = image;
    baseTitle = baseName(title);
    width = image.width;
    height = image.height;
    mask = createMask(width, height);
    syncViews();
    canvasView.fit();
  }

  function setEmptyCanvas(nextWidth, nextHeight) {
    setBaseImage({
      width: nextWidth,
      height: nextHeight,
      data: new Uint8ClampedArray(nextWidth * nextHeight * 4),
    }, '조각');
  }

  canvasView = mountRigSlice(app, {
    getBaseImage: () => baseImage,
    getSize: () => [width, height],
    getMask: () => mask,
    getPieces: () => pieces,
    snapshot: historySnapshot,
    commit: recordChange,
    renderPiecesList: () => libraryView.render(),
  });
  libraryView = mountSliceLibrary(app, {
    getPieces: () => pieces,
    getBaseImage: () => baseImage,
    getMask: () => mask,
    getSize: () => [width, height],
    setEmptyCanvas,
    drawOverlay: () => canvasView.drawOverlay(),
    snapshot: historySnapshot,
    commit: recordChange,
  });

  $('#rig-open-base').addEventListener('click', async () => {
    try {
      const [file] = await pickFiles({ accept: 'image/*' });
      if (!file) return;
      const before = historySnapshot();
      const image = dropKey(await readImageFile(file));
      if (pieces.length && (image.width !== width || image.height !== height)) {
        return app.toast(`새 그림 크기(${image.width}×${image.height})가 보관한 조각 크기(${width}×${height})와 다릅니다`);
      }
      setBaseImage(image, file.name);
      recordChange(before);
      app.toast(`「${file.name}」을 불러왔습니다`);
    } catch (error) {
      app.toast(error.message || '원본 그림을 열 수 없습니다');
    }
  });

  undoButton.addEventListener('click', () => applyHistory(history.undo(historySnapshot())));
  redoButton.addEventListener('click', () => applyHistory(history.redo(historySnapshot())));
  canvasView.render();
  libraryView.render();
  updateUndoRedo();

  return {
    shown() {
      canvasView.fit();
      canvasView.render();
    },
    getPieces: () => pieces,
    snapshot() {
      return {
        canvas: [width, height],
        basePng: baseImage ? toPngDataUrl(baseImage) : null,
        item: baseTitle,
        mask: Array.from(mask),
        pieces: pieces.map(piece => toSliceLibraryItem(piece)),
      };
    },
    async restore(saved) {
      if (!saved || typeof saved !== 'object') return;
      const canvas = Array.isArray(saved.canvas) ? saved.canvas : [72, 64];
      width = Number(canvas[0]) || 72;
      height = Number(canvas[1]) || 64;
      baseTitle = String(saved.item || '그림');
      baseImage = saved.basePng ? await readDataUrl(saved.basePng) : null;
      pieces = [];
      for (const value of saved.pieces || []) {
        const piece = toSliceLibraryItem(value);
        pieces.push({ ...piece, image: await readDataUrl(piece.png) });
      }
      if (!baseImage && pieces.length) setEmptyCanvas(width, height);
      mask = createMask(width, height);
      if (Array.isArray(saved.mask) && saved.mask.length === mask.length) mask.set(saved.mask);
      history.clear();
      syncViews();
    },
  };
}
