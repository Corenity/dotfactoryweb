// 이미지 자르기 그림판 — 마스크 선택(손으로 자르기) 및 종류별 자르기와 줌·이동을 다룹니다.
import { clearMask, fillMask, setMaskRect, fillPolygonMask, paintBrushMask } from './core/slice.js';
import { KEY, toHex } from './core/paint.js';
import { drawPixels } from './io.js';
import { mountRigAutoSlice } from './rig-auto-slice-view.js';

const $ = sel => document.querySelector(sel);

export function mountRigSlice(app, model) {
  let cell = 4;
  let panX = 0, panY = 0;
  let sliceMode = 'manual'; // 'manual' | 'auto'
  try {
    const qMode = new URLSearchParams(window.location.search).get('sliceMode');
    if (qMode === 'auto') sliceMode = 'auto';
  } catch (e) {}
  let tool = 'box'; // 'box' | 'lasso' | 'brush' | 'eraser'
  let brushSize = 1;

  // 두 손가락 이동 및 포인터 제어
  const pointers = new Map();
  let pan = null;
  let maskBeforeStroke = null;
  let dragStart = null;
  let dragCurrent = null;
  let lassoPoints = [];

  const stage = $('#rig-stage');
  const baseCanvas = $('#rig-canvas');
  const overlayCanvas = $('#rig-overlay');
  const emptyHint = $('#rig-empty');
  const zoomText = $('#rig-zoom-text');

  let baseImage = model.getBaseImage();
  let [canvasWidth, canvasHeight] = model.getSize();
  let mask = model.getMask();

  function sync() {
    baseImage = model.getBaseImage();
    const [w, h] = model.getSize();
    canvasWidth = w;
    canvasHeight = h;
    mask = model.getMask();
  }

  // 종류별 자르기 뷰 마운트
  const autoSliceView = mountRigAutoSlice(app, {
    getBaseImage: () => model.getBaseImage(),
    getSize: () => model.getSize(),
    getPieces: () => model.getPieces(),
    snapshot: () => model.snapshot(),
    commit: before => model.commit(before),
    renderPiecesList: () => model.renderPiecesList(),
    drawOverlay: () => drawOverlay(),
  });

  function updateModeUI() {
    $('#rig-mode-manual')?.setAttribute('aria-pressed', String(sliceMode === 'manual'));
    $('#rig-mode-auto')?.setAttribute('aria-pressed', String(sliceMode === 'auto'));

    const manualRows = document.querySelectorAll('.rig-manual-slice-only');
    const autoRows = document.querySelectorAll('.rig-auto-slice-only');

    for (const el of manualRows) el.hidden = (sliceMode !== 'manual');
    for (const el of autoRows) el.hidden = (sliceMode !== 'auto');
  }

  function setSliceMode(mode) {
    sliceMode = mode;
    updateModeUI();

    if (mode === 'auto') {
      autoSliceView.init();
    }
    render();
  }

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
    updateModeUI();

    emptyHint.hidden = !!baseImage;
    baseCanvas.hidden = !baseImage;
    overlayCanvas.hidden = !baseImage;
    zoomText.textContent = `${cell}배`;

    if (!baseImage) return;

    // 1. 원본 그림판 렌더링
    if (sliceMode === 'auto') {
      const ctx = baseCanvas.getContext('2d');
      baseCanvas.width = canvasWidth * cell;
      baseCanvas.height = canvasHeight * cell;
      ctx.fillStyle = toHex(KEY);
      ctx.fillRect(0, 0, baseCanvas.width, baseCanvas.height);
    } else {
      drawPixels(baseCanvas, baseImage, cell, toHex(KEY));
    }
    baseCanvas.style.transform = `translate(${panX}px, ${panY}px)`;

    // 2. 오버레이 캔버스 크기 및 위치 맞춤
    overlayCanvas.width = canvasWidth * cell;
    overlayCanvas.height = canvasHeight * cell;
    overlayCanvas.style.transform = `translate(${panX}px, ${panY}px)`;

    drawOverlay();
  }

  function drawOverlay() {
    if (!baseImage) return;
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    if (sliceMode === 'auto') {
      autoSliceView.drawOverlay(ctx, cell, canvasWidth, canvasHeight);
      return;
    }

    // 손으로 자르기: 마스크 영역 표시 (반투명 파랑)
    ctx.fillStyle = 'rgba(40, 160, 255, 0.45)';
    for (let y = 0; y < canvasHeight; y++) {
      for (let x = 0; x < canvasWidth; x++) {
        if (mask[y * canvasWidth + x]) {
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    }

    // 드래그 중인 가이드 라인 그리기
    if (dragStart) {
      ctx.lineWidth = Math.max(1, Math.floor(cell / 4));
      if (tool === 'box') {
        const [x0, y0] = dragStart;
        const [x1, y1] = dragCurrent || dragStart;
        const left = Math.min(x0, x1), top = Math.min(y0, y1);
        const w = Math.abs(x1 - x0) + 1, h = Math.abs(y1 - y0) + 1;
        ctx.strokeStyle = '#32d74b';
        ctx.strokeRect(left * cell + 0.5, top * cell + 0.5, w * cell - 1, h * cell - 1);
      } else if (tool === 'lasso' && lassoPoints.length > 1) {
        ctx.strokeStyle = '#ffd60a';
        ctx.beginPath();
        ctx.moveTo(lassoPoints[0][0] * cell + cell / 2, lassoPoints[0][1] * cell + cell / 2);
        for (let i = 1; i < lassoPoints.length; i++) {
          ctx.lineTo(lassoPoints[i][0] * cell + cell / 2, lassoPoints[i][1] * cell + cell / 2);
        }
        ctx.stroke();
      }
    }
  }

  function cellAt(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    return [
      Math.max(0, Math.min(canvasWidth - 1, Math.floor((clientX - r.left - panX) / cell))),
      Math.max(0, Math.min(canvasHeight - 1, Math.floor((clientY - r.top - panY) / cell))),
    ];
  }

  function strokeStart(at) {
    if (sliceMode === 'auto') {
      autoSliceView.paintCell(at[0], at[1]);
      drawOverlay();
      return;
    }
    dragStart = at;
    dragCurrent = at;
    maskBeforeStroke = new Uint8Array(mask);
    if (tool === 'lasso') {
      lassoPoints = [at];
    } else if (tool === 'brush') {
      paintBrushMask(mask, canvasWidth, canvasHeight, at[0], at[1], brushSize, 1);
    } else if (tool === 'eraser') {
      paintBrushMask(mask, canvasWidth, canvasHeight, at[0], at[1], brushSize, 0);
    }
    drawOverlay();
  }

  function strokeMove(at) {
    if (sliceMode === 'auto') {
      autoSliceView.paintCell(at[0], at[1]);
      drawOverlay();
      return;
    }
    dragCurrent = at;
    if (tool === 'lasso') {
      const last = lassoPoints[lassoPoints.length - 1];
      if (!last || last[0] !== at[0] || last[1] !== at[1]) {
        lassoPoints.push(at);
      }
    } else if (tool === 'brush') {
      paintBrushMask(mask, canvasWidth, canvasHeight, at[0], at[1], brushSize, 1);
    } else if (tool === 'eraser') {
      paintBrushMask(mask, canvasWidth, canvasHeight, at[0], at[1], brushSize, 0);
    }
    drawOverlay();
  }

  function strokeEnd() {
    if (sliceMode === 'auto') return;
    if (tool === 'box' && dragStart && dragCurrent) {
      setMaskRect(mask, canvasWidth, canvasHeight, dragStart, dragCurrent, 1);
    } else if (tool === 'lasso' && lassoPoints.length >= 3) {
      fillPolygonMask(mask, canvasWidth, canvasHeight, lassoPoints, 1);
    }
    dragStart = null;
    dragCurrent = null;
    lassoPoints = [];
    maskBeforeStroke = null;
    drawOverlay();
  }

  function strokeCancel() {
    if (sliceMode === 'auto') return;
    if (maskBeforeStroke) {
      mask.set(maskBeforeStroke);
      maskBeforeStroke = null;
    }
    dragStart = null;
    dragCurrent = null;
    lassoPoints = [];
    drawOverlay();
  }

  function bindEvents() {
    // 모드 선택 단추
    $('#rig-mode-manual')?.addEventListener('click', () => setSliceMode('manual'));
    $('#rig-mode-auto')?.addEventListener('click', () => setSliceMode('auto'));

    // 도구 선택
    const tools = ['box', 'lasso', 'brush', 'eraser'];
    for (const t of tools) {
      $(`#rig-tool-${t}`)?.addEventListener('click', () => {
        tool = t;
        for (const o of tools) $(`#rig-tool-${o}`)?.setAttribute('aria-pressed', String(o === t));
      });
    }

    // 붓 크기
    $('#rig-brush-size')?.addEventListener('change', e => {
      brushSize = Number(e.target.value) || 1;
    });

    // 전체 선택 / 해제
    $('#rig-select-all')?.addEventListener('click', () => {
      if (!baseImage) return;
      fillMask(mask);
      drawOverlay();
    });
    $('#rig-clear-selection')?.addEventListener('click', () => {
      if (!baseImage) return;
      clearMask(mask);
      drawOverlay();
    });

    // 줌 조작
    $('#rig-zoom-in')?.addEventListener('click', () => zoomStep(1));
    $('#rig-zoom-out')?.addEventListener('click', () => zoomStep(-1));
    $('#rig-zoom-fit')?.addEventListener('click', fit);

    // pointer 이벤트
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
        strokeStart(at);
      } else if (pointers.size === 2) {
        strokeCancel();
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
        strokeMove(at);
      }
    });

    const onPointerUp = e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);

      if (pan) {
        if (!pointers.size) pan = null;
        return;
      }

      if (e.type === 'pointercancel') {
        strokeCancel();
        return;
      }

      strokeEnd();
    };

    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
  }

  bindEvents();
  setSliceMode(sliceMode);

  return {
    fit,
    render,
    drawOverlay,
    sync,
    setSliceMode,
    updateModeUI,
  };
}
