// 다듬기 화면 — 한 손가락으로 칠하고, 두 손가락으로 옮기고, + · − 단추로 확대 · 축소합니다.
import { blank, clone, getPixel, setPixel, floodFill, clearColor, usedColors, toHex, fromHex, History } from './core/paint.js';
import { drawPixels, pickFiles, readImageFile, readDataUrl, savePng, toPngDataUrl, baseName } from './io.js';

const $ = sel => document.querySelector(sel);
// 한 칸을 화면에서 몇 픽셀로 그릴지 고르는 단계입니다. + · − 는 이 단계를 하나씩 오갑니다.
const ZOOM_STEPS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

export function mountPaint(app) {
  const stage = $('#paint-stage');
  const canvas = $('#paint-canvas');
  let image = null, name = '그림', history = new History();
  let tool = 'pen', cell = 8, panX = 0, panY = 0;
  let strokeBefore = null, last = null;
  const pointers = new Map();
  let pan = null;

  function color() { return fromHex($('#paint-color').value); }

  function render() {
    $('#paint-empty').hidden = !!image;
    canvas.hidden = !image;
    if (!image) return;
    drawPixels(canvas, image, cell, $('#paint-backdrop').value);
    if (cell >= 8) drawGrid();
    canvas.style.transform = `translate(${panX}px, ${panY}px)`;
    $('#paint-zoom').textContent = `${cell}배`;
    $('#paint-zoom-out').disabled = cell <= ZOOM_STEPS[0];
    $('#paint-zoom-in').disabled = cell >= ZOOM_STEPS.at(-1);
    $('#paint-undo').disabled = !history.canUndo;
    $('#paint-redo').disabled = !history.canRedo;
  }

  function drawGrid() {
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= image.width; x++) { ctx.moveTo(x * cell + 0.5, 0); ctx.lineTo(x * cell + 0.5, canvas.height); }
    for (let y = 0; y <= image.height; y++) { ctx.moveTo(0, y * cell + 0.5); ctx.lineTo(canvas.width, y * cell + 0.5); }
    ctx.stroke();
  }

  function renderPalette() {
    const box = $('#paint-palette');
    box.replaceChildren();
    if (!image) return;
    for (const hex of usedColors(image).slice(0, 32)) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = hex;
      b.title = hex;
      b.setAttribute('aria-label', hex);
      b.addEventListener('click', () => { $('#paint-color').value = hex; if (tool === 'eraser' || tool === 'picker') setTool('pen'); });
      box.append(b);
    }
  }

  function fit() {
    if (!image) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    fittedWidth = w;
    cell = Math.max(1, Math.floor(Math.min(w / image.width, h / image.height)));
    panX = Math.round((w - image.width * cell) / 2);
    panY = Math.round((h - image.height * cell) / 2);
    render();
  }

  // 화면의 (x, y) 아래 칸이 그 자리에 머물게 확대를 바꿉니다.
  function zoomAt(next, x, y) {
    if (!image || next === cell) return;
    const ux = (x - panX) / cell, uy = (y - panY) / cell;
    cell = next;
    panX = Math.round(x - ux * cell);
    panY = Math.round(y - uy * cell);
    render();
  }

  // 가운데를 기준으로 다음 단계로 키우거나(+1) 줄입니다(-1). 화면에 맞추기로 생긴 단계 밖 값에서도 바로 옆 단계로 갑니다.
  function zoomStep(direction) {
    const next = direction > 0 ? ZOOM_STEPS.find(s => s > cell) : ZOOM_STEPS.findLast(s => s < cell);
    if (next) zoomAt(next, stage.clientWidth / 2, stage.clientHeight / 2);
  }

  function changed() {
    render();
    renderPalette();
    app.changed();
  }

  function setTool(next) {
    tool = next;
    for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  }

  function cellAt(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    return [Math.floor((clientX - r.left - panX) / cell), Math.floor((clientY - r.top - panY) / cell)];
  }

  function inside([x, y]) { return image && x >= 0 && y >= 0 && x < image.width && y < image.height; }

  function line([x0, y0], [x1, y1], rgba) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      setPixel(image, x0, y0, rgba);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function strokeStart(at) {
    strokeBefore = clone(image);
    last = at;
    if (tool === 'pen' || tool === 'eraser') { line(at, at, tool === 'pen' ? color() : [0, 0, 0, 0]); render(); }
  }

  function strokeMove(at) {
    if (!strokeBefore || !last) return;
    if (tool === 'pen' || tool === 'eraser') { line(last, at, tool === 'pen' ? color() : [0, 0, 0, 0]); render(); }
    last = at;
  }

  function strokeEnd(at) {
    if (!strokeBefore) return;
    if (tool === 'fill' && inside(at)) floodFill(image, at[0], at[1], color());
    if (tool === 'picker' && inside(at)) {
      const px = getPixel(image, at[0], at[1]);
      if (px[3]) { $('#paint-color').value = toHex(px); app.toast(`색을 골랐습니다 ${toHex(px)}`); setTool('pen'); }
    }
    if (!sameImage(strokeBefore, image)) { history.push(strokeBefore); changed(); }
    strokeBefore = null;
    last = null;
  }

  function strokeCancel() {
    if (strokeBefore) { image = strokeBefore; strokeBefore = null; last = null; render(); }
  }

  stage.addEventListener('pointerdown', e => {
    if (!image) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === 'mouse' && e.button !== 0) { pan = { x: e.clientX, y: e.clientY, panX, panY }; return; }
    if (pointers.size === 1) {
      const at = cellAt(e.clientX, e.clientY);
      $('#paint-pos').textContent = inside(at) ? `x ${at[0]} · y ${at[1]}` : '';
      strokeStart(at);
    } else if (pointers.size === 2) {
      // 두 번째 손가락이 닿으면 칠하던 것을 되돌리고 옮기기로 바꿉니다. 손가락 간격으로는 확대하지 않습니다.
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
      const x = list.reduce((s, p) => s + p.x, 0) / list.length, y = list.reduce((s, p) => s + p.y, 0) / list.length;
      if (list.length >= 2 || e.pointerType === 'mouse') { panX = pan.panX + Math.round(x - pan.x); panY = pan.panY + Math.round(y - pan.y); render(); }
      return;
    }
    if (pointers.size === 1 && strokeBefore) {
      const at = cellAt(e.clientX, e.clientY);
      $('#paint-pos').textContent = inside(at) ? `x ${at[0]} · y ${at[1]}` : '';
      strokeMove(at);
    }
  });

  const up = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pan) { if (!pointers.size) pan = null; return; }
    if (e.type === 'pointercancel') { strokeCancel(); return; }
    strokeEnd(cellAt(e.clientX, e.clientY));
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);

  stage.addEventListener('wheel', e => {
    if (!image) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(Math.max(1, Math.min(64, cell + (e.deltaY < 0 ? 1 : -1) * Math.max(1, Math.round(cell / 6)))), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  $('#paint-zoom-in').addEventListener('click', () => zoomStep(1));
  $('#paint-zoom-out').addEventListener('click', () => zoomStep(-1));

  for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
  $('#paint-undo').addEventListener('click', () => { const prev = history.undo(image); if (prev) { image = prev; changed(); } });
  $('#paint-redo').addEventListener('click', () => { const next = history.redo(image); if (next) { image = next; changed(); } });
  $('#paint-fit').addEventListener('click', fit);
  $('#paint-backdrop').addEventListener('change', render);
  // 왼쪽 위 모서리 칸의 색을 배경색으로 보고, 그림 전체에서 같은 색을 투명하게 합니다. 되돌리기로 돌릴 수 있습니다.
  $('#paint-clear-bg').addEventListener('click', () => {
    if (!image) { app.toast('먼저 그림을 여세요.'); return; }
    const corner = getPixel(image, 0, 0);
    if (!corner[3]) { app.toast('왼쪽 위 모서리가 이미 투명합니다.'); return; }
    const before = clone(image);
    const cleared = clearColor(image, corner);
    history.push(before);
    changed();
    app.toast(`${toHex(corner)} ${cleared}칸을 투명하게 했습니다.`);
  });
  $('#paint-open').addEventListener('click', async () => {
    const [file] = await pickFiles({ accept: 'image/png' });
    if (!file) return;
    try { load(await readImageFile(file), baseName(file.name)); } catch (err) { app.toast(`열지 못했습니다: ${err.message}`); }
  });
  $('#paint-new').addEventListener('click', () => {
    if (image && !confirm('지금 그림을 비우고 72×64 새 그림을 만들까요? 내려받지 않은 고침은 사라집니다.')) return;
    load(blank(72, 64), '새 그림');
  });
  $('#paint-save').addEventListener('click', () => image && savePng(`${name}.png`, image));
  $('#paint-to-assemble').addEventListener('click', () => image && app.addToAssemble(clone(image), name));
  // 아이폰은 주소창이 숨거나 나올 때마다 높이가 바뀝니다. 너비가 바뀔 때(가로 · 세로 돌림)만 다시 맞춰 확대를 지킵니다.
  let fittedWidth = 0;
  addEventListener('resize', () => {
    if (!image || $('#paint').hidden || stage.clientWidth === fittedWidth) return;
    fit();
  });

  function load(next, nextName) {
    image = clone(next);
    name = nextName || '그림';
    history = new History();
    requestAnimationFrame(fit);
    changed();
  }

  render();
  return {
    load,
    shown() { if (image) requestAnimationFrame(fit); },
    snapshot: () => (image ? { name, png: toPngDataUrl(image) } : null),
    async restore(saved) {
      if (!saved?.png) return;
      image = await readDataUrl(saved.png);
      name = saved.name || '그림';
      fit();
      renderPalette();
    },
  };
}

function sameImage(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}
