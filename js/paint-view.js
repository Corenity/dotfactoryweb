// 다듬기 화면 — 한 손가락으로 칠하고, 두 손가락으로 확대 · 이동합니다.
import { blank, clone, getPixel, setPixel, floodFill, usedColors, toHex, fromHex, History } from './core/paint.js';
import { drawPixels, pickFiles, readImageFile, readDataUrl, savePng, toPngDataUrl, baseName } from './io.js';

const $ = sel => document.querySelector(sel);

export function mountPaint(app) {
  const stage = $('#paint-stage');
  const canvas = $('#paint-canvas');
  let image = null, name = '그림', history = new History();
  let tool = 'pen', cell = 8, panX = 0, panY = 0;
  let strokeBefore = null, last = null;
  const pointers = new Map();
  let pinch = null;

  function color() { return fromHex($('#paint-color').value); }

  function render() {
    $('#paint-empty').hidden = !!image;
    canvas.hidden = !image;
    if (!image) return;
    drawPixels(canvas, image, cell, $('#paint-backdrop').value);
    if (cell >= 8) drawGrid();
    canvas.style.transform = `translate(${panX}px, ${panY}px)`;
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
    if (e.pointerType === 'mouse' && e.button !== 0) { pinch = { mousePan: true, x: e.clientX, y: e.clientY, panX, panY }; return; }
    if (pointers.size === 1) {
      const at = cellAt(e.clientX, e.clientY);
      $('#paint-pos').textContent = inside(at) ? `x ${at[0]} · y ${at[1]}` : '';
      strokeStart(at);
    } else if (pointers.size === 2) {
      // 두 번째 손가락이 닿으면 칠하던 것을 되돌리고 확대 · 이동으로 바꿉니다.
      strokeCancel();
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, cell, panX, panY };
    }
  });

  stage.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch?.mousePan) { panX = pinch.panX + e.clientX - pinch.x; panY = pinch.panY + e.clientY - pinch.y; render(); return; }
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const next = Math.max(1, Math.min(64, Math.round(pinch.cell * dist / pinch.dist)));
      const r = stage.getBoundingClientRect();
      // 두 손가락 가운데 아래의 칸이 손가락을 따라오게 맞춥니다.
      const ux = (pinch.cx - r.left - pinch.panX) / pinch.cell, uy = (pinch.cy - r.top - pinch.panY) / pinch.cell;
      cell = next;
      panX = Math.round(cx - r.left - ux * cell);
      panY = Math.round(cy - r.top - uy * cell);
      render();
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
    if (pinch) { if (!pointers.size) pinch = null; return; }
    if (e.type === 'pointercancel') { strokeCancel(); return; }
    strokeEnd(cellAt(e.clientX, e.clientY));
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);

  stage.addEventListener('wheel', e => {
    if (!image) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const ux = (e.clientX - r.left - panX) / cell, uy = (e.clientY - r.top - panY) / cell;
    cell = Math.max(1, Math.min(64, cell + (e.deltaY < 0 ? 1 : -1) * Math.max(1, Math.round(cell / 6))));
    panX = Math.round(e.clientX - r.left - ux * cell);
    panY = Math.round(e.clientY - r.top - uy * cell);
    render();
  }, { passive: false });

  for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
  $('#paint-undo').addEventListener('click', () => { const prev = history.undo(image); if (prev) { image = prev; changed(); } });
  $('#paint-redo').addEventListener('click', () => { const next = history.redo(image); if (next) { image = next; changed(); } });
  $('#paint-fit').addEventListener('click', fit);
  $('#paint-backdrop').addEventListener('change', render);
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
