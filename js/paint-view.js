// 다듬기 화면 — 한 손가락으로 칠하고, 두 손가락으로 옮기고, + · − 단추로 확대 · 축소합니다.
// 대볼 그림 한 장은 합치기와 같이 그림 위에 반쯤 비치게 얹어 맞춰 보는 데만 쓰고, 내려받기 · 합치기에 더하기에는 넣지 않습니다.
import { blank, clone, getPixel, setPixel, floodFill, usedColors, rememberColor, forgetColor, shiftPixels, toHex, fromHex, History, KEY, dropKey, fillKey } from './core/paint.js';
import { overlayGuide, guidePixelAt, guideOpacity, moveGuide, GUIDE_OPACITY } from './core/assemble.js';
import { drawPixels, pickFiles, readImageFile, readDataUrl, savePng, toPngDataUrl, baseName } from './io.js';
import { selectRect, insideRect, lift, fillPiece, place } from './core/select.js';
import { loadColors, saveColors } from './store.js';
import { currentCanvas } from './core/profile.js';
import { importRegionConfig, regionGuideImage } from './core/region-slice.js';
import { mergeSimilarColors } from './core/color-merge.js';

const $ = sel => document.querySelector(sel);
// 한 칸을 화면에서 몇 픽셀로 그릴지 고르는 단계입니다. + · − 는 이 단계를 하나씩 오갑니다.
const ZOOM_STEPS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
// 내 색 칸을 이만큼 누르고 있으면 그 색을 뺍니다.
const LONG_PRESS_MS = 500;
// 화면에 맞춘 그림 위아래에 남길 빈 곳(px)입니다.
const FIT_PAD = 12;

export function mountPaint(app) {
  const stage = $('#paint-stage');
  const workspace = $('.paint-workspace');
  const canvas = $('#paint-canvas');
  const colorBtn = $('#paint-color-btn'), selectionColorBtn = $('#paint-selection-color'), colorPop = $('#paint-color-pop');
  let image = null, name = '그림', history = new History();
  let guide = null; // { image, name, opacity, dx, dy, kind?: 'regions' }
  let activeView = 'original';
  let mine = loadColors(); // 내 색: 다른 색에서 고른 색. 그림을 바꿔도 남습니다.
  let tool = 'pen', cell = 8, panX = 0, panY = 0;
  let strokeBefore = null, last = null;
  // 선택: marquee 는 네모를 긋는 중({ from, rect }), sel 은 떼어 낸 칸({ x, y, w, h, base, piece, before, drag }).
  // 선택 중 image 는 늘 base 위에 piece 를 얹은 모습이라 내려받기 · 자동 보관은 보이는 그대로 담습니다.
  let marquee = null, sel = null;
  const pointers = new Map();
  let pan = null;

  // 배경 초록으로 칠하면 그 칸은 배경(투명)이 됩니다. 불러올 때 초록을 배경으로 보는 것과 같게 둡니다.
  function color() {
    const c = fromHex($('#paint-color').value);
    return c.every((v, i) => v === KEY[i]) ? [0, 0, 0, 0] : c;
  }
  // 칠할 색을 바꾸고 도구 줄의 색 단추에도 같은 색을 칠합니다.
  function setColor(hex) { $('#paint-color').value = hex; showColor(); }
  function showColor() { colorBtn.style.background = $('#paint-color').value; $('#paint-selection-color-chip').style.background = $('#paint-color').value; }
  function closeColors() {
    colorPop.hidden = true;
    colorBtn.setAttribute('aria-expanded', 'false');
    selectionColorBtn.setAttribute('aria-expanded', 'false');
  }

  function render() {
    renderGuide();
    renderSelectionBar();
    for (const b of document.querySelectorAll('[data-paint-panel="original"] [data-move]')) b.disabled = !image;
    for (const b of document.querySelectorAll('[data-paint-panel="compare"] [data-move]')) b.disabled = !image || !guide;
    $('#paint-empty').hidden = !!image;
    canvas.hidden = !image;
    if (!image) return;
    drawPixels(canvas, guide ? overlayGuide(image, guide.image, guide.opacity, guide.dx, guide.dy) : image, cell, toHex(KEY));
    if (cell >= 8) drawGrid();
    drawSelection();
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

  // 고른 네모를 흰 점선과 검은 점선을 엇갈려 그려 어느 배경에서도 보이게 합니다.
  function drawSelection() {
    const r = sel || marquee?.rect;
    if (!r) return;
    const ctx = canvas.getContext('2d');
    const box = [r.x * cell + 1, r.y * cell + 1, r.w * cell - 2, r.h * cell - 2];
    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(...box);
    ctx.lineDashOffset = 4;
    ctx.strokeStyle = '#000';
    ctx.strokeRect(...box);
    ctx.restore();
  }

  function renderSelectionBar() {
    $('#paint-selection-actions').hidden = !sel;
    if (sel) $('#paint-pos').textContent = `선택 ${sel.w}×${sel.h} · x ${sel.x} · y ${sel.y}`;
  }

  // 떼어 낸 칸을 지금 자리에 내려놓고 선택을 끝냅니다. 고른 때부터 놓을 때까지가 되돌리기 한 단계입니다.
  function dropSelection() {
    marquee = null;
    if (!sel) return;
    const { before } = sel;
    sel = null;
    $('#paint-pos').textContent = '';
    if (!sameImage(before, image)) { history.push(before); changed(); } else render();
  }

  function moveSelection(x, y) {
    if (x === sel.x && y === sel.y) return false;
    sel.x = x;
    sel.y = y;
    image = place(sel.base, sel.piece, x, y);
    return true;
  }

  // 옮긴 선택은 먼저 한 단계로 확정한 뒤 칠하기·지우기 직전 모습을 다시 담습니다.
  // 새 조각을 같은 자리에서 다시 보여 주고 기준(before)을 갱신해, 선택은 남지만 각 편집은 되돌리기 한 단계가 됩니다.
  function editSelection(rgba) {
    if (!sel) return;
    const before = clone(image), piece = fillPiece(sel.piece, rgba);
    const next = place(sel.base, piece, sel.x, sel.y);
    if (sameImage(before, next)) return;
    if (!sameImage(sel.before, before)) history.push(sel.before);
    history.push(before);
    sel.piece = piece;
    image = next;
    sel.before = clone(image);
    changed();
  }

  // 선택 안을 누르면 옮기기, 밖을 누르면 지금 선택을 내려놓고 새 네모를 긋습니다.
  function selectStart(at) {
    if (sel && insideRect(sel, at)) { sel.drag = { from: at, x: sel.x, y: sel.y }; return; }
    dropSelection();
    marquee = { from: at, rect: selectRect(at, at, image.width, image.height) };
    render();
  }

  function selectMove(at) {
    if (sel?.drag) {
      if (moveSelection(sel.drag.x + at[0] - sel.drag.from[0], sel.drag.y + at[1] - sel.drag.from[1])) render();
    } else if (marquee) {
      marquee.rect = selectRect(marquee.from, at, image.width, image.height);
      render();
    }
  }

  function selectEnd() {
    if (sel?.drag) {
      const moved = sel.x !== sel.drag.x || sel.y !== sel.drag.y;
      sel.drag = null;
      if (moved) changed();
      return;
    }
    const rect = marquee?.rect;
    marquee = null;
    if (rect) {
      sel = { ...rect, ...lift(image, rect), before: clone(image), drag: null };
    }
    render();
  }

  // 두 번째 손가락이 닿으면 긋던 네모는 버리고, 옮기던 선택은 끌기 전 자리로 돌립니다.
  function selectCancel() {
    if (sel?.drag) { moveSelection(sel.drag.x, sel.drag.y); sel.drag = null; }
    marquee = null;
    render();
  }

  function renderGuide() {
    for (const b of document.querySelectorAll('[data-paint-view]')) {
      b.setAttribute('aria-pressed', String(b.dataset.paintView === activeView));
    }
    for (const panel of document.querySelectorAll('[data-paint-panel]')) panel.hidden = panel.dataset.paintPanel !== activeView;
    $('#paint-guide-pick').textContent = guide ? '빼기' : '고르기';
    $('#paint-guide-pick').setAttribute('aria-expanded', 'false');
    if (guide) $('#paint-guide-menu').hidden = true;
    const opacity = guide ? guide.opacity : GUIDE_OPACITY;
    $('#paint-guide-opacity').value = String(Math.round(opacity * 100));
    $('#paint-guide-opacity').disabled = !guide;
    $('#paint-guide-opacity-value').textContent = `${Math.round(opacity * 100)}%`;
  }

  function closeGuideMenu() {
    $('#paint-guide-menu').hidden = true;
    $('#paint-guide-pick').setAttribute('aria-expanded', 'false');
  }

  function expectedGuideCanvas() {
    return image ? [image.width, image.height] : currentCanvas();
  }

  function useRegionGuide(config, label) {
    const state = importRegionConfig(config, expectedGuideCanvas());
    guide = { image: regionGuideImage(state), name: label, kind: 'regions', opacity: guide?.opacity ?? GUIDE_OPACITY,
      dx: guide?.dx ?? 0, dy: guide?.dy ?? 0 };
    changed();
  }

  // 색 칸을 누르면 그 색으로 칠합니다. onLongPress 가 있으면 길게 눌렀을 때 그것만 하고 색은 고르지 않습니다.
  function swatch(hex, onLongPress) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = hex;
    b.title = hex;
    b.setAttribute('aria-label', hex);
    let timer = 0, long = false;
    if (onLongPress) {
      b.addEventListener('pointerdown', () => { long = false; timer = setTimeout(() => { long = true; onLongPress(); }, LONG_PRESS_MS); });
      for (const type of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(type, () => clearTimeout(timer));
      b.addEventListener('contextmenu', e => e.preventDefault());
    }
    b.addEventListener('click', () => { if (long) return; setColor(hex); closeColors(); if (tool === 'eraser' || tool === 'picker') setTool('pen'); });
    return b;
  }

  function renderPalette() {
    const box = $('#paint-palette');
    box.replaceChildren();
    if (!image) return;
    for (const hex of usedColors(image).slice(0, 32)) box.append(swatch(hex));
  }

  function renderMine() {
    $('#paint-mine').replaceChildren(...mine.map(hex => swatch(hex, () => {
      mine = forgetColor(mine, hex);
      saveColors(mine);
      renderMine();
      app.toast(`내 색에서 뺐습니다 ${hex}`);
    })));
  }

  // 맞춘 그림보다 그림판이 높으면 그림판을 그림 높이 + 위아래 FIT_PAD 로 줄여 빈 곳을 없앱니다.
  // 한도는 단추 줄을 뺀 남는 높이(CSS 에서 늘어나는 그림판)이고, 줄일 때는 늘어나지 않게 고정합니다.
  function fit() {
    if (!image) return;
    workspace.style.height = workspace.style.minHeight = workspace.style.flex = '';
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    fittedWidth = w;
    cell = Math.max(1, Math.floor(Math.min(w / image.width, h / image.height)));
    const fitted = image.height * cell + FIT_PAD * 2;
    if (fitted < h) {
      workspace.style.height = `${fitted + workspace.offsetHeight - h}px`;
      workspace.style.minHeight = '0';
      workspace.style.flex = '0 0 auto';
    }
    panX = Math.round((w - image.width * cell) / 2);
    panY = Math.round((stage.clientHeight - image.height * cell) / 2);
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
    if (next !== 'select') dropSelection();
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
    if (tool === 'select') { selectStart(at); return; }
    if (tool === 'pen' || tool === 'eraser') { line(at, at, tool === 'pen' ? color() : [0, 0, 0, 0]); render(); }
  }

  function strokeMove(at) {
    if (!strokeBefore || !last) return;
    if (tool === 'select') { selectMove(at); return; }
    if (tool === 'pen' || tool === 'eraser') { line(last, at, tool === 'pen' ? color() : [0, 0, 0, 0]); render(); }
    last = at;
  }

  function strokeEnd(at) {
    if (!strokeBefore) return;
    if (tool === 'select') { selectMove(at); selectEnd(); strokeBefore = null; last = null; return; }
    if (tool === 'fill' && inside(at)) floodFill(image, at[0], at[1], color());
    if (tool === 'picker' && inside(at)) {
      // 「비교」 메뉴에서 대볼 그림이 보이는 동안은 그 그림의 원래 색을 가져옵니다.
      const px = activeView === 'compare' && guide ? guidePixelAt(guide.image, at[0], at[1], guide.dx, guide.dy) : getPixel(image, at[0], at[1]);
      if (px?.[3]) { setColor(toHex(px)); app.toast(`색을 골랐습니다 ${toHex(px)}`); setTool('pen'); }
    }
    if (!sameImage(strokeBefore, image)) { history.push(strokeBefore); changed(); }
    strokeBefore = null;
    last = null;
  }

  function strokeCancel() {
    if (strokeBefore && tool === 'select') { strokeBefore = null; last = null; selectCancel(); return; }
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
  // 그림판 위에 뜬 선택 단추를 눌러도 그림판이 칠하거나 선택을 내려놓지 않게 합니다.
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    $('#paint-selection-actions').addEventListener(type, e => e.stopPropagation());
  }

  stage.addEventListener('wheel', e => {
    if (!image) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(Math.max(1, Math.min(64, cell + (e.deltaY < 0 ? 1 : -1) * Math.max(1, Math.round(cell / 6)))), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  $('#paint-zoom-in').addEventListener('click', () => zoomStep(1));
  $('#paint-zoom-out').addEventListener('click', () => zoomStep(-1));

  for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
  // 위쪽 색 단추와 선택 줄의 색 단추는 같은 팝업을 엽니다. 팝업 밖을 누르면 닫힙니다.
  function toggleColors(button) {
    const opening = colorPop.hidden;
    closeColors();
    colorPop.hidden = !opening;
    button.setAttribute('aria-expanded', String(opening));
  }
  colorBtn.addEventListener('click', () => toggleColors(colorBtn));
  selectionColorBtn.addEventListener('click', () => toggleColors(selectionColorBtn));
  document.addEventListener('pointerdown', e => {
    if (!colorPop.hidden && !colorPop.contains(e.target) && !colorBtn.contains(e.target) && !selectionColorBtn.contains(e.target)) closeColors();
  });
  $('#paint-color').addEventListener('input', showColor);
  // 다른 색 고르기를 마치면(change) 그 색을 내 색 맨 앞에 남깁니다. 고르는 도중(input)의 색은 남기지 않습니다.
  $('#paint-color').addEventListener('change', () => { mine = rememberColor(mine, $('#paint-color').value); saveColors(mine); renderMine(); });
  showColor();
  renderMine();
  $('#paint-selection-fill').addEventListener('click', () => editSelection(color()));
  $('#paint-selection-erase').addEventListener('click', () => editSelection([0, 0, 0, 0]));
  // 선택 중에 되돌리면 먼저 내려놓으니, 옮긴 것 전체가 한 번에 되돌아갑니다.
  $('#paint-undo').addEventListener('click', () => { dropSelection(); const prev = history.undo(image); if (prev) { image = prev; changed(); } });
  $('#paint-redo').addEventListener('click', () => { dropSelection(); const next = history.redo(image); if (next) { image = next; changed(); } });
  $('#paint-fit').addEventListener('click', fit);
  $('#paint-open').addEventListener('click', async () => {
    const [file] = await pickFiles({ accept: 'image/png' });
    if (!file) return;
    try { load(await readImageFile(file), baseName(file.name)); } catch (err) { app.toast(`열지 못했습니다: ${err.message}`); }
  });
  $('#paint-new').addEventListener('click', () => {
    const [width, height] = currentCanvas();
    if (image && !confirm(`지금 그림을 비우고 ${width}×${height} 새 그림을 만들까요? 내려받지 않은 고침은 사라집니다.`)) return;
    load(blank(width, height), '새 그림');
  });
  for (const b of document.querySelectorAll('[data-paint-view]')) b.addEventListener('click', () => {
    activeView = b.dataset.paintView;
    closeGuideMenu();
    render();
  });
  $('#paint-guide-pick').addEventListener('click', () => {
    if (guide) { guide = null; closeGuideMenu(); changed(); return; }
    const menu = $('#paint-guide-menu');
    menu.hidden = !menu.hidden;
    $('#paint-guide-pick').setAttribute('aria-expanded', String(!menu.hidden));
  });
  for (const option of $('#paint-guide-menu').querySelectorAll('[data-guide-source]')) option.addEventListener('click', async () => {
    closeGuideMenu();
    const source = option.dataset.guideSource;
    if (source === 'png') {
      const [file] = await pickFiles({ accept: 'image/png' });
      if (!file) return;
      try {
        // 바꾸기로 다른 그림을 골라도 맞춰 둔 진하기와 위치는 그대로 둡니다.
        guide = { image: dropKey(await readImageFile(file)), name: baseName(file.name), opacity: guide?.opacity ?? GUIDE_OPACITY,
          dx: guide?.dx ?? 0, dy: guide?.dy ?? 0 };
        changed();
      } catch (err) { app.toast(`${file.name} 을 읽지 못했습니다`); }
      return;
    }
    const [file] = await pickFiles({ accept: '.json,application/json' });
    if (!file) return;
    try {
      useRegionGuide(JSON.parse(await file.text()), baseName(file.name));
    } catch (err) { app.toast(err.message || '영역 설정을 불러오지 못했습니다'); }
  });
  $('#paint-guide-opacity').addEventListener('input', () => { if (guide) { guide.opacity = guideOpacity($('#paint-guide-opacity').value / 100); changed(); } });
  // 「비교」 메뉴를 고른 동안은 대볼 그림만 옮깁니다. 아니면 선택 영역, 그림 전체 순서로 대상을 정합니다.
  // 그림 전체가 판 밖으로 나간 칸은 잘리며 한 칸씩 되돌릴 수 있고, 선택 영역은 내려놓을 때 한 단계로 기록합니다.
  for (const b of document.querySelectorAll('[data-paint-panel] [data-move]')) b.addEventListener('click', () => {
    if (!image) return;
    const [dx, dy] = b.dataset.move.split(',').map(Number);
    if (activeView === 'compare' && guide) { guide = moveGuide(guide, dx, dy); changed(); return; }
    if (sel) { if (moveSelection(sel.x + dx, sel.y + dy)) changed(); return; }
    const next = shiftPixels(image, dx, dy);
    if (sameImage(image, next)) return;
    history.push(image);
    image = next;
    changed();
  });
  $('#paint-save').addEventListener('click', () => image && savePng(`${name}.png`, fillKey(image)));
  $('#paint-to-assemble').addEventListener('click', () => image && app.addToAssemble(clone(image), name));

  $('#paint-clean-level').addEventListener('input', () => {
    $('#paint-clean-val').textContent = `${$('#paint-clean-level').value}%`;
  });
  $('#paint-clean-run').addEventListener('click', () => {
    if (!image) return;
    dropSelection();
    const level = Number($('#paint-clean-level').value) || 5;
    const threshold = level / 100;
    const before = image;
    const res = mergeSimilarColors(image, { threshold });
    if (res.changedPixels > 0) {
      history.push(before);
      image = res.image;
      changed();
    }
    $('#paint-clean-status').textContent = `${res.beforeCount}색 → ${res.afterCount}색 (${res.changedPixels}칸 정리)`;
  });
  // 아이폰은 주소창이 숨거나 나올 때마다 높이가 바뀝니다. 너비가 바뀔 때(가로 · 세로 돌림)만 다시 맞춰 확대를 지킵니다.
  let fittedWidth = 0;
  addEventListener('resize', () => {
    if (!image || $('#paint').hidden || stage.clientWidth === fittedWidth) return;
    fit();
  });

  // 어디서 온 그림이든 배경 초록 칸은 투명으로 바꿔 받습니다.
  function load(next, nextName) {
    sel = marquee = null;
    image = dropKey(next);
    name = nextName || '그림';
    if (guide?.kind === 'regions' && (guide.image.width !== image.width || guide.image.height !== image.height)) {
      app.toast(`대볼 영역의 그림판 크기(${guide.image.width}×${guide.image.height})가 편집 그림 크기(${image.width}×${image.height})와 달라 뺐습니다`);
      guide = null;
    }
    history = new History();
    $('#paint-clean-status').textContent = '';
    requestAnimationFrame(fit);
    changed();
  }

  render();
  return {
    load,
    shown() { if (image) requestAnimationFrame(fit); },
    snapshot: () => (image || guide ? {
      ...(image ? { name, png: toPngDataUrl(image) } : {}),
      ...(guide && guide.kind !== 'regions' ? { guide: { name: guide.name, visible: true, opacity: guide.opacity, dx: guide.dx, dy: guide.dy, png: toPngDataUrl(guide.image) } } : {}),
    } : null),
    async restore(saved) {
      const g = saved?.guide;
      if (typeof g?.png === 'string') guide = { name: g.name || '대볼 그림',
        opacity: g.visible === false ? 0 : guideOpacity(g.opacity), dx: Math.trunc(Number(g.dx) || 0), dy: Math.trunc(Number(g.dy) || 0),
        image: dropKey(await readDataUrl(g.png)) };
      if (!saved?.png) { render(); return; }
      sel = marquee = null;
      image = dropKey(await readDataUrl(saved.png));
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
