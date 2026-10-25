// site/js/rig-slice-view.js — 자르기 그림판 뷰 모듈 (색 영역 오버레이 렌더링, 줌·이동, 붓/지우개)
import { KEY, toHex } from './core/paint.js';

const $ = sel => document.querySelector(sel);

function hexToRgba(hex, alpha = 0.6) {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function mountRigSlice(app, model) {
  let cell = 4;
  let panX = 0, panY = 0;

  const pointers = new Map();
  let pan = null;
  let isDrawing = false;

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

    // 1. 원본 그림판 배경 (초록) 채우기 및 원본 도트 그리기
    const ctx = baseCanvas.getContext('2d');
    baseCanvas.width = canvasWidth * cell;
    baseCanvas.height = canvasHeight * cell;
    ctx.fillStyle = toHex(KEY);
    ctx.fillRect(0, 0, baseCanvas.width, baseCanvas.height);

    // 원본 도트 렌더링
    const imgData = baseImage.data;
    for (let y = 0; y < canvasHeight; y++) {
      for (let x = 0; x < canvasWidth; x++) {
        const p4 = (y * canvasWidth + x) * 4;
        const a = imgData[p4 + 3];
        if (a > 0) {
          ctx.fillStyle = `rgba(${imgData[p4]}, ${imgData[p4 + 1]}, ${imgData[p4 + 2]}, ${a / 255})`;
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    }
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

    const state = model.getRegionState();
    if (!state) return;

    const tool = model.getActiveTool();
    const selectedColor = model.getSelectedRegion();
    const visibleRegions = model.getVisibleRegions();

    // 규칙: 어떤 영역을 골라 칠하는 중에는 다른 영역 색은 보이지 않는다.
    // 지우개 모드이거나 선택된 영역이 없는 경우 켜져 있는 모든 영역 표시
    const focusMode = tool === 'brush' && !!selectedColor;

    const { width, height, regions, grid } = state;

    for (let rIdx = 0; rIdx < regions.length; rIdx++) {
      const color = regions[rIdx];
      const targetLabel = rIdx + 1;

      if (focusMode) {
        if (color !== selectedColor) continue;
      } else {
        if (!visibleRegions.has(color)) continue;
      }

      ctx.fillStyle = hexToRgba(color, 0.65);
      for (let y = 0; y < height; y++) {
        const rowStart = y * width;
        for (let x = 0; x < width; x++) {
          if (grid[rowStart + x] === targetLabel) {
            ctx.fillRect(x * cell, y * cell, cell, cell);
          }
        }
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

  function paintAt(clientX, clientY) {
    const [cx, cy] = cellAt(clientX, clientY);
    model.onPaintCell(cx, cy);
  }

  function bindEvents() {
    $('#rig-zoom-in')?.addEventListener('click', () => zoomStep(1));
    $('#rig-zoom-out')?.addEventListener('click', () => zoomStep(-1));
    $('#rig-zoom-fit')?.addEventListener('click', fit);

    // 포인터 이벤트: 1손가락 붓/지우개 칠하기, 2손가락 화면 이동
    stage.addEventListener('pointerdown', e => {
      if (!baseImage) return;
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (e.pointerType === 'mouse' && e.button !== 0) {
        pan = { x: e.clientX, y: e.clientY, panX, panY };
        return;
      }

      if (pointers.size === 1) {
        isDrawing = true;
        model.onStrokeStart();
        paintAt(e.clientX, e.clientY);
        drawOverlay();
      } else if (pointers.size === 2) {
        if (isDrawing) {
          isDrawing = false;
          model.onStrokeEnd();
        }
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

      if (isDrawing && pointers.size === 1) {
        paintAt(e.clientX, e.clientY);
        drawOverlay();
      }
    });

    const onPointerUp = e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);

      if (isDrawing && pointers.size === 0) {
        isDrawing = false;
        model.onStrokeEnd();
      }

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
  };
}
