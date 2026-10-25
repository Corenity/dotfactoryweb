// 합치기 화면 — 그림 여러 장을 층 번호 · 보이기 · 칸 이동으로 겹쳐 보고 저장합니다.
// 대볼 그림 한 장은 합친 그림 위에 반쯤 비치게 얹어 맞춰 보는 데만 쓰고, 합친 그림 내려받기에는 넣지 않습니다.
import { compose, overlayGuide, guideOpacity, layerOpacity, GUIDE_OPACITY, canvasSizeFor, nextLayer, MIN_LAYER, clampLayer, toProject, parseProject } from './core/assemble.js';
import { drawPixels, pickFiles, readImageFile, readDataUrl, savePng, saveJson, toPngDataUrl, baseName, desktopCanvasActive, mountDesktopCanvasPan } from './io.js';
import { dropKey } from './core/paint.js';
import { backdropToggle } from './backdrop.js';

const $ = sel => document.querySelector(sel);

export function mountAssemble(app) {
  let items = [];
  let guide = null; // { image, name, opacity }
  let panX = 0, panY = 0;
  const canvas = $('#asm-canvas'), stage = canvas.parentElement;
  // 맨 아래에 초록을 깔아 보여 줍니다. 넣는 그림은 초록 칸을 투명으로 바꿔 받아 아래를 가리지 않습니다.
  const bg = backdropToggle($('#asm-clear'), render);
  mountDesktopCanvasPan(stage, {
    readPan: () => ({ x: panX, y: panY }),
    writePan: (x, y) => { panX = Math.round(x); panY = Math.round(y); drawStage(); },
    onResize: drawStage,
  });

  // 대볼 그림도 그림판 크기에 넣어, 부위만 있을 때와 대볼 그림을 얹었을 때 판이 같게 합니다.
  function size() { return canvasSizeFor(guide ? [...items, guide] : items); }

  function render() {
    drawStage();
    renderGuide();
    renderList();
  }

  // 화면에서는 그림마다 진하기만큼 비쳐 보입니다(fade). 진하기 밀대를 끄는 동안은 목록을 다시 만들지 않고 이것만 다시 그립니다.
  function drawStage() {
    const [w, h] = size();
    const desktop = desktopCanvasActive();
    const availableWidth = desktop ? Math.max(1, (stage.clientWidth || 360) - 16) : Math.min(stage.clientWidth || 360, 480);
    const availableHeight = desktop ? Math.max(1, (stage.clientHeight || 320) - 16) : Infinity;
    const scale = Math.max(1, Math.floor(Math.min(availableWidth / w, availableHeight / h)));
    const shown = compose(items, w, h, { fade: true });
    drawPixels(canvas, guide ? overlayGuide(shown, guide.image, guide.opacity) : shown, scale, bg.backdrop);
    canvas.style.transform = `translate(${panX}px, ${panY}px)`;
    $('#asm-size').textContent = items.length ? `${w}×${h} 칸 · 그림 ${items.length}장` : '그림을 더하세요';
  }

  function renderGuide() {
    $('#asm-guide-name').textContent = guide ? guide.name : '없음';
    $('#asm-guide-pick').textContent = guide ? '바꾸기' : '고르기';
    $('#asm-guide-drop').hidden = !guide;
    const opacity = guide ? guide.opacity : GUIDE_OPACITY;
    $('#asm-guide-opacity').value = String(Math.round(opacity * 100));
    $('#asm-guide-opacity').disabled = !guide;
    $('#asm-guide-opacity-value').textContent = `${Math.round(opacity * 100)}%`;
  }

  function renderList() {
    const list = $('#asm-list');
    list.replaceChildren();
    // 위에 오는 그림(층 번호 큰 것)이 목록 위에 오게 보여 줍니다.
    const shown = items.map((item, index) => ({ item, index })).sort((a, b) => b.item.layer - a.item.layer || b.index - a.index);
    for (const { item } of shown) {
      const li = document.createElement('li');
      li.className = 'layer';
      const thumb = document.createElement('canvas');
      thumb.className = 'pixels thumb';
      drawPixels(thumb, item.image, 1, bg.backdrop);
      const title = document.createElement('span');
      title.className = 'name';
      title.textContent = item.name;
      const layer = numberInput(item.layer, v => { item.layer = v; changed(); });
      layer.setAttribute('aria-label', `${item.name} 층 번호`);
      const layerUp = button('▲', () => { item.layer++; changed(); }, `${item.name} 한 층 올리기`);
      const layerDown = button('▼', () => { item.layer = clampLayer(item.layer - 1); changed(); }, `${item.name} 한 층 내리기`);
      layerDown.disabled = item.layer <= MIN_LAYER;
      // 좁은 화면에서 줄이 넘어가도 ▲ ▼ 가 갈라지지 않게 한 묶음으로 둡니다.
      const layerSteps = document.createElement('span');
      layerSteps.className = 'arrows';
      layerSteps.append(layerUp, layerDown);
      const visible = document.createElement('input');
      visible.type = 'checkbox';
      visible.checked = item.visible;
      visible.setAttribute('aria-label', `${item.name} 보이기`);
      visible.addEventListener('change', () => { item.visible = visible.checked; changed(); });
      const pos = document.createElement('span');
      pos.className = 'hint';
      pos.textContent = `${item.dx}, ${item.dy}`;
      const arrows = document.createElement('span');
      arrows.className = 'arrows';
      for (const [label, dx, dy] of [['←', -1, 0], ['→', 1, 0], ['↑', 0, -1], ['↓', 0, 1]]) {
        arrows.append(button(label, () => { item.dx += dx; item.dy += dy; changed(); }, `${item.name} ${label} 한 칸`));
      }
      const tools = document.createElement('span');
      tools.className = 'item-tools';
      tools.append(
        button('편집', () => app.sendToPaint(item.image, item.name)),
        button('빼기', () => { if (confirm(`「${item.name}」을 합치기에서 뺄까요?`)) { items = items.filter(i => i !== item); changed(); } }),
      );
      const top = document.createElement('div');
      top.className = 'layer-top';
      const layerLabel = document.createElement('label');
      layerLabel.className = 'inline';
      layerLabel.append('층', layer);
      const visibleLabel = document.createElement('label');
      visibleLabel.className = 'inline';
      visibleLabel.append(visible, '보이기');
      top.append(thumb, title, layerLabel, layerSteps, visibleLabel);
      const bottom = document.createElement('div');
      bottom.className = 'layer-bottom';
      bottom.append(arrows, pos, tools);
      li.append(top, opacityRow(item), bottom);
      list.append(li);
    }
  }

  // 그림마다 진하기 밀대(0~100%, 10% 단위)입니다. 화면에서만 비치고, 합친 그림 내려받기는 늘 100% 입니다.
  function opacityRow(item) {
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '10';
    slider.value = String(Math.round(layerOpacity(item.opacity) * 100));
    slider.setAttribute('aria-label', `${item.name} 진하기`);
    const value = document.createElement('span');
    value.textContent = `${slider.value}%`;
    slider.addEventListener('input', () => {
      item.opacity = layerOpacity(slider.value / 100);
      value.textContent = `${Math.round(item.opacity * 100)}%`;
      drawStage();
    });
    slider.addEventListener('change', () => app.changed());
    const label = document.createElement('label');
    label.className = 'inline guide-opacity layer-opacity';
    label.append('진하기', slider, value);
    return label;
  }

  function changed() {
    render();
    app.changed();
  }

  function add(image, name) {
    items.push({ image: dropKey(image), name, layer: nextLayer(items), visible: true, dx: 0, dy: 0, opacity: 1 });
    changed();
  }

  $('#asm-add').addEventListener('click', async () => {
    const files = await pickFiles({ accept: 'image/png', multiple: true });
    for (const file of files) {
      try { add(await readImageFile(file), baseName(file.name)); } catch (err) { app.toast(`${file.name} 을 읽지 못했습니다`); }
    }
  });
  $('#asm-guide-pick').addEventListener('click', async () => {
    const [file] = await pickFiles({ accept: 'image/png' });
    if (!file) return;
    try {
      // 바꾸기로 다른 그림을 골라도 맞춰 둔 진하기는 그대로 둡니다.
      guide = { image: dropKey(await readImageFile(file)), name: baseName(file.name), opacity: guide?.opacity ?? GUIDE_OPACITY };
      changed();
    } catch (err) { app.toast(`${file.name} 을 읽지 못했습니다`); }
  });
  $('#asm-guide-drop').addEventListener('click', () => { guide = null; changed(); });
  $('#asm-guide-opacity').addEventListener('input', () => { if (guide) { guide.opacity = guideOpacity($('#asm-guide-opacity').value / 100); changed(); } });
  $('#asm-save-png').addEventListener('click', () => {
    if (!items.length) return;
    const [w, h] = size();
    // 진하기는 넣지 않습니다(fade 없음) — 받는 그림에 반투명 칸이 생기지 않게 늘 100% 로 겹칩니다.
    savePng('합친그림.png', bg.forSave(compose(items, w, h)));
  });
  $('#asm-save-json').addEventListener('click', () => {
    if (!items.length) return;
    const [w, h] = size();
    saveJson('합치기설정.json', toProject(items, w, h, toPngDataUrl, guide));
  });
  $('#asm-open').addEventListener('click', async () => {
    const [file] = await pickFiles({ accept: 'application/json,.json' });
    if (!file) return;
    try {
      await restore(JSON.parse(await file.text()));
      app.changed();
      app.toast(`그림 ${items.length}장을 열었습니다`);
    } catch (err) {
      app.toast(`열지 못했습니다: ${err.message}`);
    }
  });

  async function restore(json) {
    const project = parseProject(json);
    app.warnCanvas?.(project.canvas, '합치기 설정');
    const loaded = [];
    for (const i of project.items) loaded.push({ ...i, image: dropKey(await readDataUrl(i.png)), png: undefined });
    const g = project.guide;
    guide = g ? { name: g.name, visible: g.visible, opacity: g.opacity, image: dropKey(await readDataUrl(g.png)) } : null;
    items = loaded;
    render();
  }

  render();
  return {
    add,
    shown: render,
    snapshot: () => (items.length || guide ? toProject(items, ...size(), toPngDataUrl, guide) : null),
    restore,
  };
}

function button(label, onClick, aria) {
  const b = document.createElement('button');
  b.className = 'btn small';
  b.textContent = label;
  if (aria) b.setAttribute('aria-label', aria);
  b.addEventListener('click', onClick);
  return b;
}

function numberInput(value, onChange) {
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'numeric';
  input.value = String(value);
  input.min = String(MIN_LAYER);
  input.className = 'layer-number';
  input.addEventListener('change', () => onChange(clampLayer(input.value)));
  return input;
}
