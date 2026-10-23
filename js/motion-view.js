// 뼈 애니메이션 3단계 화면 — 시간 줄, 끊어지는 키, 양파 껍질, 재생과 GIF를 다룹니다.
import { boneLabel, defaultAnimations } from './core/rig.js';
import { boneWorldTransforms, composeRig, worldDeltaToLocal } from './core/rig-render.js';
import { changeMotionLength, changeMotionStep, copyPreviousKey, deleteKey, frameTimes, hasKey, poseAt, renderMotionFrames, setKey } from './core/motion.js';
import { encodeGif } from './core/gif.js';
import { drawPixels, saveFile, saveJson, pickFiles } from './io.js';
import { toAnimation, parseAnimation, checkSkeletonCompatibility, adaptAnimationToBones, mergeAnimations } from './core/animation.js';

const $ = selector => document.querySelector(selector);
const rounded = value => Number(Number(value).toFixed(9));

export function mountMotion(app, model) {
  const panel = $('#rig-motion-panel');
  const stage = $('#motion-stage');
  const canvas = $('#motion-canvas');
  const onionCanvas = $('#motion-onion-canvas');
  const bonesCanvas = $('#motion-bones-canvas');
  const empty = $('#motion-empty');
  const timeline = $('#motion-timeline');
  const tree = $('#motion-bone-tree');
  const select = $('#motion-select');
  const nameInput = $('#motion-name');
  const lengthInput = $('#motion-length');
  const stepInput = $('#motion-step');
  const loopInput = $('#motion-loop');
  const xInput = $('#motion-bone-x');
  const yInput = $('#motion-bone-y');
  const angleInput = $('#motion-bone-angle');
  const status = $('#motion-key-status');
  const zoomText = $('#motion-zoom-text');
  const playButton = $('#motion-play');
  const onionButton = $('#motion-onion');

  let currentName = 'walk';
  let selected = 'Torso';
  let currentTime = 0;
  let onion = false;
  let cell = 4;
  let panX = 0, panY = 0;
  let playing = false;
  let animationFrame = 0;
  let startedAt = 0;
  const pointers = new Map();
  let dragging = null;
  let dragBefore = null;
  let panning = null;

  const animations = () => model.getAnimations();
  const bones = () => model.getBones();
  const pieces = () => model.getPieces();
  const motion = () => animations()[currentName] || Object.values(animations())[0];
  const selectedBone = posed => posed.find(bone => bone.name === selected) || posed[0];
  const slotTime = time => {
    const times = frameTimes(motion());
    let found = times[0];
    for (const value of times) if (value <= time + 1e-7) found = value;
    return found;
  };

  function replaceMotion(next, quiet = false) {
    try {
      model.setAnimations({ ...animations(), [currentName]: next });
      if (!quiet) app.changed();
      return true;
    } catch (error) {
      app.toast(error.message);
      return false;
    }
  }

  function stop() {
    playing = false;
    cancelAnimationFrame(animationFrame);
    playButton.textContent = '▶ 재생';
  }

  function fit() {
    const [width, height] = model.getSize();
    const stageWidth = stage.clientWidth || 320, stageHeight = stage.clientHeight || 240;
    cell = Math.max(1, Math.floor(Math.min(stageWidth / width, stageHeight / height)));
    panX = Math.round((stageWidth - width * cell) / 2);
    panY = Math.round((stageHeight - height * cell) / 2);
    render();
  }

  function zoom(direction) {
    const next = Math.max(1, Math.min(16, cell + direction));
    if (next === cell) return;
    const cx = (stage.clientWidth || 320) / 2, cy = (stage.clientHeight || 240) / 2;
    const x = (cx - panX) / cell, y = (cy - panY) / cell;
    cell = next; panX = Math.round(cx - x * cell); panY = Math.round(cy - y * cell);
    render();
  }

  function drawBones(posed) {
    const [width, height] = model.getSize();
    bonesCanvas.width = width * cell; bonesCanvas.height = height * cell;
    const ctx = bonesCanvas.getContext('2d');
    ctx.clearRect(0, 0, bonesCanvas.width, bonesCanvas.height);
    const world = boneWorldTransforms(posed);
    ctx.lineWidth = Math.max(2, cell / 2); ctx.strokeStyle = '#ffd60a';
    for (const bone of posed) {
      if (!bone.parent) continue;
      const point = world.get(bone.name), parent = world.get(bone.parent);
      ctx.beginPath(); ctx.moveTo(parent.x * cell, parent.y * cell); ctx.lineTo(point.x * cell, point.y * cell); ctx.stroke();
    }
    for (const bone of posed) {
      const point = world.get(bone.name);
      ctx.beginPath(); ctx.arc(point.x * cell, point.y * cell, bone.name === selected ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = bone.name === selected ? '#32d74b' : '#ffffff';
      ctx.fill(); ctx.strokeStyle = '#111114'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  function render() {
    const active = motion();
    if (!active) return;
    const posed = poseAt(bones(), active, currentTime);
    const [width, height] = model.getSize();
    drawPixels(canvas, composeRig(pieces(), posed, width, height, bones(), model.getPresetLayers?.() || []), cell, model.getBackdrop());
    const transform = `translate(${panX}px, ${panY}px)`;
    canvas.style.transform = transform;

    const previous = Math.max(0, slotTime(currentTime) - active.step);
    onionCanvas.hidden = !onion || currentTime < active.step - 1e-7;
    if (!onionCanvas.hidden) drawPixels(onionCanvas, composeRig(pieces(), poseAt(bones(), active, previous), width, height, bones(), model.getPresetLayers?.() || []), cell, null);
    onionCanvas.style.transform = transform;
    drawBones(posed); bonesCanvas.style.transform = transform;
    zoomText.textContent = `${cell}배`;
    empty.hidden = pieces().length > 0;
  }

  function refreshMotionPick() {
    const names = Object.keys(animations());
    if (!names.includes(currentName)) currentName = names[0];
    select.textContent = '';
    for (const name of names) {
      const option = document.createElement('option'); option.value = name; option.textContent = name; select.append(option);
    }
    select.value = currentName;
    const active = motion();
    nameInput.value = currentName;
    lengthInput.value = String(active.length);
    stepInput.value = String(active.step);
    loopInput.checked = active.loop;
    $('#motion-drop').disabled = names.length <= 1;
  }

  function refreshTimeline() {
    timeline.textContent = '';
    const active = motion(), at = slotTime(currentTime);
    for (const time of frameTimes(active)) {
      const button = document.createElement('button');
      button.className = 'btn motion-time';
      button.textContent = `${Number(time.toFixed(3))}초`;
      button.setAttribute('aria-pressed', String(Math.abs(time - at) <= 1e-7));
      if (Object.keys(active.tracks).some(name => hasKey(active, name, time))) button.classList.add('has-key');
      button.addEventListener('click', () => { stop(); currentTime = time; refresh(); });
      timeline.append(button);
    }
  }

  function refreshTree() {
    const posed = poseAt(bones(), motion(), currentTime);
    if (!posed.some(bone => bone.name === selected)) selected = posed[0]?.name || '';
    tree.textContent = '';
    for (const bone of posed) {
      const button = document.createElement('button');
      button.className = 'btn'; button.textContent = boneLabel(bone.name);
      button.setAttribute('aria-pressed', String(bone.name === selected));
      button.addEventListener('click', () => { selected = bone.name; refresh(); });
      tree.append(button);
    }
  }

  function refreshKeyControls() {
    const active = motion(), at = slotTime(currentTime);
    const bone = selectedBone(poseAt(bones(), active, currentTime));
    if (!bone) return;
    xInput.value = String(bone.pos[0]); yInput.value = String(bone.pos[1]); angleInput.value = String(bone.angle);
    const keyed = hasKey(active, bone.name, at);
    status.textContent = `${Number(at.toFixed(3))}초 · ${keyed ? '이 뼈의 키가 있습니다' : '뼈대 자세 또는 앞 키를 보여 줍니다'}`;
    $('#motion-drop-key').disabled = !keyed;
    $('#motion-copy-key').disabled = at < active.step - 1e-7;
  }

  function refresh() {
    refreshMotionPick();
    refreshTimeline();
    refreshTree();
    refreshKeyControls();
    render();
  }

  function updateKey(change) {
    stop();
    const active = motion(), at = slotTime(currentTime);
    const bone = selectedBone(poseAt(bones(), active, at));
    if (!bone) return;
    const before = model.snapshot?.();
    const nextPose = { ...bone, pos: [...bone.pos], ...change };
    if (replaceMotion(setKey(active, bone.name, at, nextPose))) {
      refresh();
      model.commit?.(before);
    }
  }

  function updateSettings(change) {
    stop();
    const before = model.snapshot?.();
    if (replaceMotion({ ...motion(), ...change })) {
      currentTime = Math.min(currentTime, Math.max(0, motion().length - motion().step));
      refresh();
      model.commit?.(before);
    } else refreshMotionPick();
  }

  function hitBone(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    const x = clientX - rect.left - panX, y = clientY - rect.top - panY;
    const posed = poseAt(bones(), motion(), currentTime);
    const world = boneWorldTransforms(posed);
    let best = null, distance = 22 * 22;
    for (const bone of posed) {
      const point = world.get(bone.name);
      const dx = point.x * cell - x, dy = point.y * cell - y, d = dx * dx + dy * dy;
      if (d <= distance) { best = bone.name; distance = d; }
    }
    return best;
  }

  function bindPointers() {
    stage.addEventListener('pointerdown', event => {
      stage.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        const hit = hitBone(event.clientX, event.clientY);
        if (hit) {
          stop(); selected = hit;
          const pose = selectedBone(poseAt(bones(), motion(), slotTime(currentTime)));
          dragBefore = model.snapshot?.();
          dragging = { x: event.clientX, y: event.clientY, pose: { ...pose, pos: [...pose.pos] }, changed: false };
          refresh();
        }
      } else if (pointers.size === 2) {
        dragging = null;
        dragBefore = null;
        const points = [...pointers.values()];
        panning = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2, panX, panY };
      }
    });
    stage.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (panning && pointers.size >= 2) {
        const points = [...pointers.values()];
        const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
        const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
        panX = panning.panX + Math.round(x - panning.x); panY = panning.panY + Math.round(y - panning.y); render();
      } else if (dragging && pointers.size === 1) {
        const dx = (event.clientX - dragging.x) / cell, dy = (event.clientY - dragging.y) / cell;
        const posed = poseAt(bones(), motion(), slotTime(currentTime));
        const [localX, localY] = worldDeltaToLocal(posed, selected, dx, dy);
        const pos = [Math.round(dragging.pose.pos[0] + localX), Math.round(dragging.pose.pos[1] + localY)];
        dragging.changed = true;
        replaceMotion(setKey(motion(), selected, slotTime(currentTime), { ...dragging.pose, pos }), true);
        refreshKeyControls(); render();
      }
    });
    const end = event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (dragging?.changed) {
        app.changed();
        refreshTimeline();
        if (dragBefore) model.commit?.(dragBefore);
      }
      if (pointers.size < 2) panning = null;
      if (!pointers.size) {
        dragging = null;
        dragBefore = null;
      }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  }

  function playFrame(now) {
    if (!playing) return;
    const active = motion(), elapsed = (now - startedAt) / 1000;
    if (!active.loop && elapsed >= active.length) {
      currentTime = Math.max(0, active.length - 1e-7); stop(); refresh(); return;
    }
    currentTime = active.loop ? elapsed % active.length : Math.min(elapsed, Math.max(0, active.length - 1e-7));
    refreshTimeline(); refreshKeyControls(); render();
    animationFrame = requestAnimationFrame(playFrame);
  }

  function bindEvents() {
    select.addEventListener('change', () => { stop(); currentName = select.value; currentTime = 0; refresh(); });
    $('#motion-add').addEventListener('click', () => {
      stop();
      let index = 1, name = 'motion';
      while (name in animations()) name = `motion${++index}`;
      const before = model.snapshot?.();
      model.setAnimations({ ...animations(), [name]: defaultAnimations().walk });
      currentName = name; currentTime = 0; app.changed(); refresh();
      model.commit?.(before);
    });
    $('#motion-drop').addEventListener('click', () => {
      if (Object.keys(animations()).length <= 1) return;
      stop();
      const before = model.snapshot?.();
      const next = { ...animations() }; delete next[currentName]; model.setAnimations(next);
      currentName = Object.keys(next)[0]; currentTime = 0; app.changed(); refresh();
      model.commit?.(before);
    });
    nameInput.addEventListener('change', () => {
      const nextName = nameInput.value.trim();
      if (!nextName || (nextName !== currentName && nextName in animations())) { app.toast('움직임 이름이 비었거나 겹칩니다'); refreshMotionPick(); return; }
      if (nextName === currentName) return;
      const before = model.snapshot?.();
      const next = {};
      for (const [name, value] of Object.entries(animations())) next[name === currentName ? nextName : name] = value;
      model.setAnimations(next); currentName = nextName; app.changed(); refresh();
      model.commit?.(before);
    });
    lengthInput.addEventListener('change', () => {
      stop();
      const length = Number(lengthInput.value);
      const before = model.snapshot?.();
      const changed = changeMotionLength(motion(), length);
      if (replaceMotion(changed.motion)) {
        currentTime = Math.min(currentTime, Math.max(0, motion().length - motion().step));
        refresh();
        model.commit?.(before);
        if (changed.removed) app.toast(`${rounded(length)}초 뒤 키 ${changed.removed}개를 지웠습니다`);
      } else refreshMotionPick();
    });
    stepInput.addEventListener('change', () => {
      stop();
      const step = Number(stepInput.value);
      const changed = changeMotionStep(motion(), step);
      if (changed.mismatched) {
        app.toast(`키 간격을 ${rounded(step)}초로 바꾸면 키 ${changed.mismatched}개가 칸에 맞지 않습니다. 그 키를 지운 뒤 바꿔 주세요`);
        refreshMotionPick();
        return;
      }
      const before = model.snapshot?.();
      if (replaceMotion(changed.motion)) {
        currentTime = Math.min(currentTime, Math.max(0, motion().length - motion().step));
        refresh();
        model.commit?.(before);
      } else refreshMotionPick();
    });
    loopInput.addEventListener('change', () => updateSettings({ loop: loopInput.checked }));
    playButton.addEventListener('click', () => {
      if (playing) { stop(); return; }
      playing = true; currentTime = 0; startedAt = performance.now(); playButton.textContent = '■ 정지';
      animationFrame = requestAnimationFrame(playFrame);
    });
    onionButton.addEventListener('click', () => { onion = !onion; onionButton.setAttribute('aria-pressed', String(onion)); render(); });
    $('#motion-zoom-in').addEventListener('click', () => zoom(1));
    $('#motion-zoom-out').addEventListener('click', () => zoom(-1));
    $('#motion-zoom-fit').addEventListener('click', fit);
    const updatePosition = () => updateKey({ pos: [Math.trunc(Number(xInput.value)), Math.trunc(Number(yInput.value))] });
    xInput.addEventListener('change', updatePosition); yInput.addEventListener('change', updatePosition);
    angleInput.addEventListener('change', () => updateKey({ angle: Math.trunc(Number(angleInput.value)) }));
    const nudge = (dx, dy) => { const bone = selectedBone(poseAt(bones(), motion(), slotTime(currentTime))); updateKey({ pos: [bone.pos[0] + dx, bone.pos[1] + dy] }); };
    $('#motion-bone-up').addEventListener('click', () => nudge(0, -1));
    $('#motion-bone-left').addEventListener('click', () => nudge(-1, 0));
    $('#motion-bone-down').addEventListener('click', () => nudge(0, 1));
    $('#motion-bone-right').addEventListener('click', () => nudge(1, 0));
    $('#motion-angle-minus').addEventListener('click', () => { const bone = selectedBone(poseAt(bones(), motion(), slotTime(currentTime))); updateKey({ angle: bone.angle - 15 }); });
    $('#motion-angle-plus').addEventListener('click', () => { const bone = selectedBone(poseAt(bones(), motion(), slotTime(currentTime))); updateKey({ angle: bone.angle + 15 }); });
    $('#motion-drop-key').addEventListener('click', () => {
      const before = model.snapshot?.();
      if (replaceMotion(deleteKey(motion(), selected, slotTime(currentTime)))) {
        refresh();
        model.commit?.(before);
      }
    });
    $('#motion-copy-key').addEventListener('click', () => {
      const before = model.snapshot?.();
      if (replaceMotion(copyPreviousKey(bones(), motion(), selected, slotTime(currentTime)))) {
        refresh();
        model.commit?.(before);
      }
    });
    $('#motion-save-gif').addEventListener('click', async () => {
      const active = motion(), [width, height] = model.getSize();
      const made = renderMotionFrames(pieces(), bones(), active, width, height, model.getPresetLayers?.() || []);
      const frames = made.frames;
      const bytes = encodeGif(frames, made.delays, { loop: active.loop });
      const safeName = currentName.replace(/[\\/:*?"<>|]/g, '_');
      const result = await saveFile(`${safeName}.gif`, new Blob([bytes], { type: 'image/gif' }));
      if (result !== 'cancelled') app.toast(`「${safeName}.gif」을 만들었습니다`);
    });
    const saveAnimBtn = $('#motion-save');
    if (saveAnimBtn) {
      saveAnimBtn.addEventListener('click', async () => {
        const activeMotions = model.getAnimations();
        const boneNames = bones().map(b => b.name);
        const animObj = toAnimation({
          skeleton: 'character_skeleton',
          bones: boneNames,
          motions: activeMotions,
        });
        const item = model.getItem?.() || currentName || '캐릭터';
        const fileName = `${item}_애니.json`;
        const result = await saveJson(fileName, animObj);
        if (result !== 'cancelled') {
          app.toast(`「${fileName}」으로 저장했습니다`);
        }
      });
    }

    const openAnimBtn = $('#motion-open');
    if (openAnimBtn) {
      openAnimBtn.addEventListener('click', async () => {
        try {
          const [file] = await pickFiles({ accept: '.json,application/json,text/plain' });
          if (!file) return;
          const animObj = parseAnimation(JSON.parse(await file.text()));
          const compat = checkSkeletonCompatibility(animObj, bones());
          const adaptedMotions = adaptAnimationToBones(animObj, bones());
          const before = model.snapshot?.();
          const merge = mergeAnimations(model.getAnimations(), adaptedMotions);
          model.setAnimations(merge.motions);
          const firstIncomingName = Object.keys(adaptedMotions)[0];
          if (firstIncomingName) currentName = firstIncomingName;
          currentTime = 0;
          refresh();
          model.commit?.(before);

          let msg = `애니메이션 ${merge.totalIncomingCount}개를 불러왔습니다`;
          if (merge.overwrittenCount > 0) msg += ` (덮어씀 ${merge.overwrittenCount}개)`;
          if (compat.warnings.length > 0) msg += ` · ${compat.warnings[0]}`;
          app.toast(msg);
        } catch (err) {
          app.toast(err.message || '애니메이션 파일을 열 수 없습니다');
        }
      });
    }

    bindPointers();
  }

  bindEvents();

  return {
    show() { panel.hidden = false; refresh(); fit(); },
    hide() { stop(); panel.hidden = true; },
    refresh() { refresh(); },
    shown() { if (!panel.hidden) fit(); },
  };
}
