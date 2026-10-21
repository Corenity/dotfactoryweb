// 재생 화면 — 다 만든 그림 여러 장을 프레임으로 이어 움직임을 보고, 움직이는 GIF 로 내려받습니다.
// 그림은 한 번에 여러 장 넣거나 나중에 더하고, 순서 · 프레임별 시간(ms)을 고칩니다. PC 도트 편집기 프레임 목록을 옮겼습니다.
import { MIN_MS, MAX_MS, frameMs, stageSize, placeOnStage, byName, toPlay, parsePlay } from './core/frames.js';
import { encodeGif } from './core/gif.js';
import { drawPixels, pickFiles, readImageFile, readDataUrl, saveFile, toPngDataUrl, baseName } from './io.js';
import { dropKey } from './core/paint.js';
import { backdropToggle } from './backdrop.js';

const $ = sel => document.querySelector(sel);

export function mountPlay(app) {
  let frames = []; // { image, name, ms, png }
  let selected = 0;
  const play = { on: false, index: 0, timer: 0 };
  const bg = backdropToggle($('#play-clear'), render);

  function loop() { return $('#play-loop').value !== 'once'; }

  function render() {
    renderStage(play.on ? play.index : selected);
    const total = frames.reduce((sum, f) => sum + f.ms, 0);
    $('#play-count').textContent = frames.length ? `${frames.length}장 · 한 바퀴 ${total}ms` : '그림을 더하세요';
    $('#play-toggle').disabled = !frames.length;
    $('#play-save-gif').disabled = !frames.length;
    $('#play-drop-all').disabled = !frames.length;
    renderList();
  }

  function renderStage(index) {
    const canvas = $('#play-canvas');
    const frame = frames[index];
    $('#play-empty').hidden = !!frame;
    canvas.hidden = !frame;
    $('#play-at').textContent = frame ? `${index + 1} / ${frames.length} · ${frame.ms}ms` : '';
    if (!frame) return;
    const [w, h] = stageSize(frames.map(f => f.image));
    const scale = Math.max(1, Math.floor(Math.min(canvas.parentElement.clientWidth || 360, 480) / w));
    drawPixels(canvas, placeOnStage(frame.image, w, h), scale, bg.backdrop);
  }

  function renderList() {
    const list = $('#play-list');
    list.replaceChildren(...frames.map((frame, index) => row(frame, index)));
  }

  function row(frame, index) {
    const li = document.createElement('li');
    li.className = `layer${index === selected ? ' selected' : ''}`;
    const thumb = document.createElement('canvas');
    thumb.className = 'pixels thumb';
    drawPixels(thumb, frame.image, 1, bg.backdrop);
    thumb.addEventListener('click', () => select(index));
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'name';
    title.textContent = `${index + 1}. ${frame.name}`;
    title.addEventListener('click', () => select(index));
    const ms = document.createElement('input');
    ms.type = 'number';
    ms.inputMode = 'numeric';
    ms.min = String(MIN_MS); ms.max = String(MAX_MS); ms.step = '10';
    ms.value = String(frame.ms);
    ms.className = 'frame-ms';
    ms.setAttribute('aria-label', `${index + 1}번 그림 시간(ms)`);
    ms.addEventListener('change', () => { frame.ms = frameMs(ms.value); changed(); });
    const msLabel = document.createElement('label');
    msLabel.className = 'inline';
    msLabel.append(ms, 'ms');
    const top = document.createElement('div');
    top.className = 'layer-top';
    top.append(thumb, title, msLabel);
    const arrows = document.createElement('span');
    arrows.className = 'arrows';
    arrows.append(
      button('↑', () => move(index, -1), `${index + 1}번 그림을 앞으로`, index === 0),
      button('↓', () => move(index, 1), `${index + 1}번 그림을 뒤로`, index === frames.length - 1),
    );
    const tools = document.createElement('span');
    tools.className = 'item-tools';
    tools.append(
      button('복제', () => { frames.splice(index + 1, 0, { ...frame }); selected = index + 1; changed(); }, `${index + 1}번 그림을 바로 뒤에 복제`),
      button('빼기', () => remove(index), `${index + 1}번 그림 빼기`),
    );
    const bottom = document.createElement('div');
    bottom.className = 'layer-bottom';
    bottom.append(arrows, tools);
    li.append(top, bottom);
    return li;
  }

  function select(index) {
    selected = index;
    if (!play.on) render(); else renderList();
  }

  function move(index, step) {
    const next = index + step;
    if (next < 0 || next >= frames.length) return;
    [frames[index], frames[next]] = [frames[next], frames[index]];
    selected = selected === index ? next : selected === next ? index : selected;
    changed();
  }

  function remove(index) {
    frames.splice(index, 1);
    selected = Math.min(selected, Math.max(0, frames.length - 1));
    if (!frames.length) stop();
    changed();
  }

  function changed() {
    render();
    app.changed();
  }

  function step() {
    // 다른 화면으로 가면 멈춥니다.
    if (!frames.length || $('#play').hidden) { stop(); return; }
    play.index %= frames.length;
    renderStage(play.index);
    play.timer = setTimeout(() => {
      if (play.index + 1 >= frames.length && !loop()) { stop(); return; }
      play.index = (play.index + 1) % frames.length;
      step();
    }, frames[play.index].ms);
  }

  function stop() {
    clearTimeout(play.timer);
    play.on = false;
    $('#play-toggle').textContent = '▶ 재생';
    render();
  }

  $('#play-add').addEventListener('click', async () => {
    const files = await pickFiles({ accept: 'image/png', multiple: true });
    // 한 번에 고른 그림은 이름 순서(걷기1, 걷기2, … 걷기10)로 목록 끝에 붙입니다.
    files.sort((a, b) => byName(a.name, b.name));
    const ms = frameMs($('#play-default-ms').value);
    for (const file of files) {
      try {
        const image = dropKey(await readImageFile(file));
        frames.push({ image, name: baseName(file.name), ms, png: toPngDataUrl(image) });
      } catch (err) { app.toast(`${file.name} 을 읽지 못했습니다`); }
    }
    if (files.length) changed();
  });
  $('#play-default-ms').addEventListener('change', () => { $('#play-default-ms').value = String(frameMs($('#play-default-ms').value)); });
  $('#play-toggle').addEventListener('click', () => {
    if (play.on) { stop(); return; }
    if (!frames.length) return;
    play.on = true;
    play.index = 0;
    $('#play-toggle').textContent = '■ 멈춤';
    step();
  });
  $('#play-loop').addEventListener('change', () => app.changed());
  $('#play-drop-all').addEventListener('click', () => {
    if (!frames.length || !confirm(`그림 ${frames.length}장을 모두 뺄까요?`)) return;
    frames = [];
    selected = 0;
    stop();
    app.changed();
  });
  // 공유 창(아이폰)은 누른 직후에만 열리므로 GIF 는 기다림 없이 바로 만들어 넘깁니다.
  $('#play-save-gif').addEventListener('click', () => {
    if (!frames.length) return;
    const [w, h] = stageSize(frames.map(f => f.image));
    const images = frames.map(f => bg.forSave(placeOnStage(f.image, w, h)));
    const bytes = encodeGif(images, frames.map(f => f.ms), { loop: loop() });
    saveFile(`${frames[0].name}-재생.gif`, new Blob([bytes], { type: 'image/gif' }));
  });

  async function restore(json) {
    const saved = parsePlay(json);
    const loaded = [];
    for (const f of saved.frames) loaded.push({ ...f, image: dropKey(await readDataUrl(f.png)) });
    frames = loaded;
    selected = 0;
    $('#play-loop').value = saved.loop ? 'loop' : 'once';
    render();
  }

  render();
  return {
    shown: render,
    snapshot: () => (frames.length ? toPlay(frames, loop()) : null),
    restore,
  };
}

function button(label, onClick, aria, disabled = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn small';
  b.textContent = label;
  b.disabled = disabled;
  if (aria) b.setAttribute('aria-label', aria);
  b.addEventListener('click', onClick);
  return b;
}
