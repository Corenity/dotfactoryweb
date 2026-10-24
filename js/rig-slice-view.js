// site/js/rig-slice-view.js — 자르기 그림판 뷰 모듈 (자동 분할 캔버스 렌더링 및 줌·이동·부위 칠하기)
import { KEY, toHex } from './core/paint.js';
import { mountRigAutoSlice } from './rig-auto-slice-view.js';

const $ = sel => document.querySelector(sel);

export function mountRigSlice(app, model) {
  let cell = 4;
  let panX = 0, panY = 0;

  const pointers = new Map();
  let pan = null;

  const stage = $('#rig-stage');
  const baseCanvas = $('#rig-canvas');
  const overlayCanvas = $('#rig-overlay');
  const emptyHint = $('#rig-empty');
  const zoomText = $('#rig-zoom-text');

  let baseImage = model.getBaseImage();
  let [canvasWidth, canvasHeight] = model.getSize();

  function sync() {
    baseImage = model.getBaseImage();
    const [w, h] = model.getSize();
    canvasWidth = w;
    canvasHeight = h;
  }

  // 자동 분할 뷰 마운트
  const autoSliceView = mountRigAutoSlice(app, {
    getBaseImage: () => model.getBaseImage(),
    getSize: () => model.getSize(),
    getPieces: () => model.getPieces(),
    snapshot: () => model.snapshot(),
    commit: before => model.commit(before),
    renderPiecesList: () => model.renderPiecesList(),
    drawOverlay: () => drawOverlay(),
  });

  function fit() {
    if (!baseImage) return;
    const w = stage.clientWidth || 320;
    const h = stage.clientHeight || 240;
    cell = Math.max(1, Math.floor(Math.min(w / canvasWidth, h / canvasHeight)));
    panX = Math.round((w - canvasWidth * cell) / 2);
    panY = Math.round((h - canvasHeight * cell) / 2);
    render();
  }

  function zoomStep(direction) {
    if (!baseImage) return;
    const next = Math.max(1, Math.min(16, cell + direction));
    if (next === cell) return;
    const w = stage.clientWidth || 320;
    const h = stage.clientHeight || 240;
    const cx = w / 2, cy = h / 2;
    const ux = (cx - panX) / cell, uy = (cy - panY) / cell;
    cell = next;
    panX = Math.round(cx - ux * cell);
    panY = Math.round(cy - uy * cell);
    render();
  }

  function render() {
    emptyHint.hidden = !!baseImage;
    baseCanvas.hidden = !baseImage;
    overlayCanvas.hidden = !baseImage;
    zoomText.textContent = `${cell}배`;

    if (!baseImage) return;

    // 1. 원본 그림판 배경 (초록) 채우기
    const ctx = baseCanvas.getContext('2d');
    baseCanvas.width = canvasWidth * cell;
    baseCanvas.height = canvasHeight * cell;
    ctx.fillStyle = toHex(KEY);
    ctx.fillRect(0, 0, baseCanvas.width, baseCanvas.height);
    baseCanvas.style.transform = `translate(${panX}px, ${panY}px)`;

    // 2. 오버레이 캔버스 위치 및 렌더링
    overlayCanvas.width = canvasWidth * cell;
    overlayCanvas.height = canvasHeight * cell;
    overlayCanvas.style.transform = `translate(${panX}px, ${panY}px)`;

    drawOverlay();
  }

  function drawOverlay() {
    if (!baseImage) return;
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    autoSliceView.drawOverlay(ctx, cell, canvasWidth, canvasHeight);
  }

  function cellAt(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    return [
      Math.max(0, Math.min(canvasWidth - 1, Math.floor((clientX - r.left - panX) / cell))),
      Math.max(0, Math.min(canvasHeight - 1, Math.floor((clientY - r.top - panY) / cell))),
    ];
  }

  function bindEvents() {
    // 줌 조작
    $('#rig-zoom-in')?.addEventListener('click', () => zoomStep(1));
    $('#rig-zoom-out')?.addEventListener('click', () => zoomStep(-1));
    $('#rig-zoom-fit')?.addEventListener('click', fit);

    // 포인터 이벤트 (1손가락: 붓칠, 2손가락: 이동)
    stage.addEventListener('pointerdown', e => {
      if (!baseImage) return;
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (e.pointerType === 'mouse' && e.button !== 0) {
        pan = { x: e.clientX, y: e.clientY, panX, panY };
        return;
      }

      if (pointers.size === 1) {
        const at = cellAt(e.clientX, e.clientY);
        autoSliceView.paintCell(at[0], at[1]);
        drawOverlay();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pan = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, panX, panY };
      }
    });

    stage.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pan) {
        const list = [...pointers.values()];
        const x = list.reduce((s, p) => s + p.x, 0) / list.length;
        const y = list.reduce((s, p) => s + p.y, 0) / list.length;
        if (list.length >= 2 || e.pointerType === 'mouse') {
          panX = pan.panX + Math.round(x - pan.x);
          panY = pan.panY + Math.round(y - pan.y);
          render();
        }
        return;
      }

      if (pointers.size === 1) {
        const at = cellAt(e.clientX, e.clientY);
        autoSliceView.paintCell(at[0], at[1]);
        drawOverlay();
      }
    });

    const onPointerUp = e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);

      if (pan) {
        if (!pointers.size) pan = null;
      }
    };

    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
  }

  bindEvents();

  return {
    fit,
    render,
    drawOverlay,
    sync,
    init: () => autoSliceView.init(),
  };
}
