// site/js/rig-slice-view.js — 자르기 그림판 뷰 모듈 (색 영역 오버레이 렌더링, 대볼 그림, 줌·이동, 붓/지우개)
import { KEY, toHex, dropKey } from './core/paint.js';
import { overlayGuide, GUIDE_OPACITY, guideOpacity, moveGuide } from './core/assemble.js';
import { importRegionConfig, regionGuideImage } from './core/region-slice.js';
import { pickFiles, readImageFile, baseName } from './io.js';

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
  let guide = null; // { image, name, opacity, dx, dy, kind: 'image' | 'regions' }
  let activeView = 'original';

  function sync() {
    baseImage = model.getBaseImage();
    const [w, h] = model.getSize();
    canvasWidth = w;
    canvasHeight = h;
  }

  const hasTarget = () => !!(baseImage || guide?.image);

  function fit() {
    if (!hasTarget()) return;
    const w = stage.clientWidth || 320;
    const h = stage.clientHeight || 240;
    cell = Math.max(1, Math.floor(Math.min(w / canvasWidth, h / canvasHeight)));
    panX = Math.round((w - canvasWidth * cell) / 2);
    panY = Math.round((h - canvasHeight * cell) / 2);
    render();
  }

  function zoomStep(direction) {
    if (!hasTarget()) return;
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
    const visible = hasTarget();
    emptyHint.hidden = visible;
    baseCanvas.hidden = !visible;
    overlayCanvas.hidden = !visible;
    zoomText.textContent = `${cell}배`;

    if (!visible) return;

    // 1. 원본 그림판 배경 (초록) 채우기 및 원본 도트 그리기
    const ctx = baseCanvas.getContext('2d');
    baseCanvas.width = canvasWidth * cell;
    baseCanvas.height = canvasHeight * cell;
    ctx.fillStyle = toHex(KEY);
    ctx.fillRect(0, 0, baseCanvas.width, baseCanvas.height);

    // 대볼 그림 합성: 원래 그림 위에 대볼 그림을 비치게 얹고, 그 위에 영역 색이 오도록 함
    const targetImage = baseImage || { width: canvasWidth, height: canvasHeight, data: new Uint8ClampedArray(canvasWidth * canvasHeight * 4) };
    const shown = (guide?.image)
      ? overlayGuide(targetImage, guide.image, guide.opacity, guide.dx, guide.dy)
      : targetImage;

    // 도트 렌더링
    const imgData = shown.data;
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
    if (!hasTarget()) return;
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const state = model.getRegionState();
    if (!state) return;

    const visibleRegions = model.getVisibleRegions();
    const { width, height, regions, masks } = state;
    for (let pixel = 0; pixel < width * height; pixel++) {
      for (let index = regions.length - 1; index >= 0; index--) {
        const color = regions[index];
        if (!visibleRegions.has(color) || !masks[index][pixel]) continue;
        ctx.fillStyle = hexToRgba(color, 0.65);
        ctx.fillRect((pixel % width) * cell, Math.floor(pixel / width) * cell, cell, cell);
        break;
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

  function renderGuide() {
    const pickBtn = $('#slice-guide-pick');
    const opacityInput = $('#slice-guide-opacity');
    const opacityValEl = $('#slice-guide-opacity-value');
    for (const button of document.querySelectorAll('[data-slice-view]')) {
      button.setAttribute('aria-pressed', String(button.dataset.sliceView === activeView));
    }
    for (const panel of document.querySelectorAll('[data-slice-panel]')) {
      panel.hidden = panel.dataset.slicePanel !== activeView;
    }
    if (pickBtn) {
      pickBtn.textContent = guide ? '빼기' : '고르기';
      pickBtn.setAttribute('aria-expanded', 'false');
    }
    if (guide) $('#slice-guide-menu').hidden = true;
    const opacity = guide ? guide.opacity : GUIDE_OPACITY;
    if (opacityInput) {
      opacityInput.value = String(Math.round(opacity * 100));
      opacityInput.disabled = !guide;
    }
    if (opacityValEl) opacityValEl.textContent = `${Math.round(opacity * 100)}%`;
    for (const button of document.querySelectorAll('[data-slice-guide-move]')) button.disabled = !guide;
  }

  function closeGuideMenu() {
    const menuEl = $('#slice-guide-menu');
    if (menuEl) menuEl.hidden = true;
    $('#slice-guide-pick')?.setAttribute('aria-expanded', 'false');
  }

  function initGuide() {
    const pickBtn = $('#slice-guide-pick');
    const menuEl = $('#slice-guide-menu');
    const opacityInput = $('#slice-guide-opacity');
    if (!pickBtn || !menuEl) return;

    for (const button of document.querySelectorAll('[data-slice-view]')) {
      button.addEventListener('click', () => {
        activeView = button.dataset.sliceView;
        closeGuideMenu();
        renderGuide();
      });
    }

    pickBtn.addEventListener('click', () => {
      if (guide) {
        guide = null;
        closeGuideMenu();
        renderGuide();
        render();
        return;
      }
      menuEl.hidden = !menuEl.hidden;
      pickBtn.setAttribute('aria-expanded', String(!menuEl.hidden));
    });

    for (const option of menuEl.querySelectorAll('[data-slice-guide-source]')) {
      option.addEventListener('click', async () => {
        closeGuideMenu();
        const source = option.dataset.sliceGuideSource;
        if (source === 'png') {
          const [file] = await pickFiles({ accept: 'image/png' });
          if (!file) return;
          try {
            const raw = await readImageFile(file);
            guide = {
              image: dropKey(raw),
              name: baseName(file.name),
              opacity: guide?.opacity ?? GUIDE_OPACITY,
              dx: guide?.dx ?? 0,
              dy: guide?.dy ?? 0,
              kind: 'image',
            };
            renderGuide();
            render();
          } catch {
            app.toast(`${file.name} 을 읽지 못했습니다`);
          }
          return;
        }
        const [file] = await pickFiles({ accept: '.json,application/json' });
        if (!file) return;
        try {
          const text = await file.text();
          const expected = baseImage ? [baseImage.width, baseImage.height] : [canvasWidth, canvasHeight];
          const state = importRegionConfig(JSON.parse(text), expected);
          guide = {
            image: regionGuideImage(state),
            name: baseName(file.name),
            opacity: guide?.opacity ?? GUIDE_OPACITY,
            dx: guide?.dx ?? 0,
            dy: guide?.dy ?? 0,
            kind: 'regions',
          };
          renderGuide();
          render();
        } catch (err) {
          app.toast(err.message || '영역 설정을 불러오지 못했습니다');
        }
      });
    }

    opacityInput?.addEventListener('input', () => {
      if (guide) {
        guide.opacity = guideOpacity(Number(opacityInput.value) / 100);
        renderGuide();
        render();
      }
    });

    for (const button of document.querySelectorAll('[data-slice-guide-move]')) {
      button.addEventListener('click', () => {
        if (!guide) return;
        const [dx, dy] = button.dataset.sliceGuideMove.split(',').map(Number);
        guide = moveGuide(guide, dx, dy);
        render();
      });
    }

    document.addEventListener('pointerdown', e => {
      if (!menuEl.hidden && !menuEl.contains(e.target) && !pickBtn.contains(e.target)) {
        closeGuideMenu();
      }
    });

    renderGuide();
  }

  function bindEvents() {
    $('#rig-zoom-in')?.addEventListener('click', () => zoomStep(1));
    $('#rig-zoom-out')?.addEventListener('click', () => zoomStep(-1));
    $('#rig-zoom-fit')?.addEventListener('click', fit);

    // 포인터 이벤트: 1손가락 붓/지우개 칠하기, 2손가락 화면 이동
    stage.addEventListener('pointerdown', e => {
      if (!hasTarget()) return;
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

    initGuide();
  }

  bindEvents();

  return {
    fit,
    render,
    drawOverlay,
    sync,
    getGuide: () => guide,
  };
}
