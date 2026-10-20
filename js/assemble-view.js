// 합치기 화면 — 그림 여러 장을 층 번호 · 보이기 · 칸 이동으로 겹쳐 보고 저장합니다.
import { compose, canvasSizeFor, nextLayer, toProject, parseProject } from './core/assemble.js';
import { drawPixels, pickFiles, readImageFile, readDataUrl, savePng, saveJson, toPngDataUrl, baseName } from './io.js';
import { dropKey } from './core/paint.js';
import { backdropToggle } from './backdrop.js';

const $ = sel => document.querySelector(sel);

export function mountAssemble(app) {
  let items = [];
  // 맨 아래에 초록을 깔아 보여 줍니다. 넣는 그림은 초록 칸을 투명으로 바꿔 받아 아래를 가리지 않습니다.
  const bg = backdropToggle($('#asm-clear'), render);

  function size() { return canvasSizeFor(items); }

  function render() {
    const [w, h] = size();
    const stage = $('#asm-canvas').parentElement;
    const scale = Math.max(1, Math.floor(Math.min(stage.clientWidth || 360, 480) / w));
    drawPixels($('#asm-canvas'), compose(items, w, h), scale, bg.backdrop);
    $('#asm-size').textContent = items.length ? `${w}×${h} 칸 · 그림 ${items.length}장` : '그림을 더하세요';
    renderList();
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
        button('다듬기', () => app.sendToPaint(item.image, item.name)),
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
      top.append(thumb, title, layerLabel, visibleLabel);
      const bottom = document.createElement('div');
      bottom.className = 'layer-bottom';
      bottom.append(arrows, pos, tools);
      li.append(top, bottom);
      list.append(li);
    }
  }

  function changed() {
    render();
    app.changed();
  }

  function add(image, name) {
    items.push({ image: dropKey(image), name, layer: nextLayer(items), visible: true, dx: 0, dy: 0 });
    changed();
  }

  $('#asm-add').addEventListener('click', async () => {
    const files = await pickFiles({ accept: 'image/png', multiple: true });
    for (const file of files) {
      try { add(await readImageFile(file), baseName(file.name)); } catch (err) { app.toast(`${file.name} 을 읽지 못했습니다`); }
    }
  });
  $('#asm-save-png').addEventListener('click', () => {
    if (!items.length) return;
    const [w, h] = size();
    savePng('합친그림.png', bg.forSave(compose(items, w, h)));
  });
  $('#asm-save-json').addEventListener('click', () => {
    if (!items.length) return;
    const [w, h] = size();
    saveJson('합치기설정.json', toProject(items, w, h, toPngDataUrl));
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
    const loaded = [];
    for (const i of project.items) loaded.push({ ...i, image: dropKey(await readDataUrl(i.png)), png: undefined });
    items = loaded;
    render();
  }

  render();
  return {
    add,
    shown: render,
    snapshot: () => (items.length ? toProject(items, ...size(), toPngDataUrl) : null),
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
  input.className = 'layer-number';
  input.addEventListener('change', () => onChange(Math.trunc(Number(input.value) || 0)));
  return input;
}
