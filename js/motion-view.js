// 뼈 애니메이션 3단계 화면 — 뼈별 키 줄, 끊어지는 키, 양파 껍질, 재생과 GIF를 다룹니다.
import { defaultAnimations, boneAngleToDisplay, displayAngleToBone, applyRestPose } from './core/rig.js';
import { boneWorldTransforms, composeRig, worldDeltaToLocal } from './core/rig-render.js';
import { addMotion, changeMotionLength, changeMotionStep, deleteKey, frameTimes, poseAt, renderMotionFrames, resolveMotion, setKey } from './core/motion.js';
import { mountMotionTimeline } from './motion-timeline.js';
import { encodeGif } from './core/gif.js';
import { sortRigPiecesByLayers, toggleGroupLayerVisibility } from './core/preset-layers.js';
import { drawPixels, saveFile, saveJson, pickFiles, mountDesktopCanvasPan, zoomAtAnchor } from './io.js';
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
  const loadedContent = $('#motion-loaded-content');
  const groupList = $('#motion-group-list');
  const groupAddButton = $('#motion-group-add');
  const groupDeleteButton = $('#motion-group-delete');
  const groupName = $('#motion-group-name');
  const coordinate = $('#motion-coordinate');
  const select = $('#motion-select');
  const nameInput = $('#motion-name');
  const lengthInput = $('#motion-length');
  const stepInput = $('#motion-step');
  const loopInput = $('#motion-loop');
  const angleInput = $('#motion-bone-angle');
  const rotSlider = $('#motion-rot-slider');
  const zoomText = $('#motion-zoom-text');
  const playButton = $('#motion-play');
  const onionButton = $('#motion-onion');
  const barPos = $('#motion-bar-pos');
  const barRot = $('#motion-bar-rot');
  const viewModeButton = $('#motion-view-mode-btn');
  const motionEditControls = [
    select, nameInput, lengthInput, stepInput, loopInput, playButton, onionButton, angleInput, rotSlider,
    $('#motion-bone-left'), $('#motion-bone-right'), $('#motion-bone-up'), $('#motion-bone-down'),
    $('#motion-angle-minus'), $('#motion-angle-plus'), $('#motion-save-gif'), $('#motion-save'),
  ].filter(Boolean);

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
  let bar = null;
  let rotDragBefore = null;
  let selectedGroupKey = null;
  mountDesktopCanvasPan(stage, {
    readPan: () => ({ x: panX, y: panY }),
    writePan: (x, y) => { panX = Math.round(x); panY = Math.round(y); render(); },
    onResize: () => { if (!panel.hidden) fit(); },
  });

  const animations = () => model.getAnimations();
  const bones = () => model.getBones();
  const pieces = () => model.getPieces();
  const motionState = () => resolveMotion(animations(), currentName);
  const motion = () => motionState().motion;
  const previewMotion = () => motion() || defaultAnimations().walk;
  const selectedBone = posed => posed.find(bone => bone.name === selected) || posed[0];
  const slotTime = time => {
    const times = frameTimes(previewMotion());
    let found = times[0];
    for (const value of times) if (value <= time + 1e-7) found = value;
    return found;
  };

  function replaceMotion(next, quiet = false) {
    if (!currentName || !motion()) return false;
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
    playButton.textContent = '▶';
  }

  function fit() {
    if (!model.hasRig?.()) return;
    const [width, height] = model.getSize();
    const stageWidth = stage.clientWidth || 200, stageHeight = stage.clientHeight || 256;
    cell = Math.max(1, Math.round(stageHeight / height));
    panX = Math.round((stageWidth - width * cell) / 2);
    panY = Math.round((stageHeight - height * cell) / 2);
    render();
  }

  function zoomAt(nextCell, cursorX, cursorY) {
    const next = Math.max(1, Math.min(16, nextCell));
    if (next === cell) return;
    const p = zoomAtAnchor(panX, panY, cell, next, cursorX, cursorY);
    cell = next;
    panX = p.panX;
    panY = p.panY;
    render();
  }

  function zoom(direction) {
    const cx = (stage.clientWidth || 320) / 2, cy = (stage.clientHeight || 240) / 2;
    zoomAt(cell + direction, cx, cy);
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
    if (!model.hasRig?.()) return;
    const active = previewMotion();
    const hasMotion = Boolean(motion());
    const posed = poseAt(bones(), active, currentTime);
    const [width, height] = model.getSize();
    const layers = model.getPresetLayers?.() || [];
    const mode = model.getVisibilityMode?.() || 'individual';
    const visiblePieces = sortRigPiecesByLayers(pieces(), layers, { screen: true, visibilityMode: mode });
    const restBones = applyRestPose(bones(), model.getRestPose?.()).bones;
    drawPixels(canvas, composeRig(visiblePieces, posed, width, height, restBones, layers), cell, model.getBackdrop());
    const transform = `translate(${panX}px, ${panY}px)`;
    canvas.style.transform = transform;

    const previous = Math.max(0, slotTime(currentTime) - active.step);
    onionCanvas.hidden = !hasMotion || !onion || currentTime < active.step - 1e-7;
    if (!onionCanvas.hidden) drawPixels(onionCanvas, composeRig(visiblePieces, poseAt(bones(), active, previous), width, height, restBones, layers), cell, null);
    onionCanvas.style.transform = transform;
    drawBones(posed); bonesCanvas.style.transform = transform;
    zoomText.textContent = `${cell}배`;
    empty.hidden = pieces().length > 0;
  }

  function refreshMotionPick() {
    const resolved = motionState();
    const { names, motion: active } = resolved;
    currentName = resolved.name;
    select.textContent = '';
    for (const name of names) {
      const option = document.createElement('option'); option.value = name; option.textContent = name; select.append(option);
    }
    select.value = currentName;
    nameInput.value = currentName;
    lengthInput.value = active ? String(active.length) : '';
    stepInput.value = active ? String(active.step) : '';
    loopInput.checked = active?.loop === true;
    for (const control of motionEditControls) control.disabled = !active;
    $('#motion-drop').disabled = names.length <= 1;
  }

  const keys = mountMotionTimeline({
    scroller: $('#motion-keys'), grid: $('#motion-keys-grid'), corner: $('#motion-keys-corner'), boneAdd: $('#motion-bone-add'),
    pop: $('#motion-key-pop'), addKey: $('#motion-key-add'), posKey: $('#motion-key-pos'), rotKey: $('#motion-key-rot'), dropKey: $('#motion-key-drop'),
  }, {
    read: () => ({ ready: Boolean(model.hasRig?.()), bones: bones(), motion: motion(), selected, time: slotTime(currentTime), bar }),
    seek: (name, time) => { stop(); if (name) selected = name; currentTime = time; refresh(); },
    selectBone: name => { selected = name; refresh(); },
    addKey: () => updateKey({}),
    dropKey: () => {
      const before = model.snapshot?.();
      if (replaceMotion(deleteKey(motion(), selected, slotTime(currentTime)))) {
        refresh();
        model.commit?.(before);
      }
    },
    openBar: tool => openBar(tool),
  });

  function renderGroupList() {
    if (!groupList) return;
    groupList.textContent = '';
    const layers = model.getPresetLayers?.() || [];
    if (selectedGroupKey && !layers.some(layer => layer.key === selectedGroupKey)) selectedGroupKey = null;
    if (groupDeleteButton) groupDeleteButton.disabled = !model.hasRig?.() || !selectedGroupKey;
    const selectedGroup = layers.find(layer => layer.key === selectedGroupKey);
    if (groupName) groupName.textContent = selectedGroup ? `그룹 ${selectedGroup.name}` : '';
    if (!layers.length) {
      groupList.innerHTML = '<p class="hint motion-group-empty">없음</p>';
      return;
    }
    for (const layer of layers) {
      const card = document.createElement('div');
      card.className = 'rig-group-card' + (layer.key === selectedGroupKey ? ' selected' : '');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      const name = document.createElement('span');
      name.className = 'rig-group-name';
      name.textContent = `${Array.from(layer.name || '?')[0]}…`;
      name.title = layer.name;
      const visible = layer.visible !== false;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn icon rig-group-vis-btn';
      button.textContent = '';
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('aria-label', `${layer.name} ${visible ? '숨기기' : '보이기'}`);
      button.addEventListener('click', event => {
        event.stopPropagation();
        const before = model.snapshot?.();
        model.setPresetLayers?.(toggleGroupLayerVisibility(layers, layer.key));
        model.setVisibilityMode?.('group');
        model.commit?.(before);
        refresh();
      });
      card.addEventListener('click', () => {
        selectedGroupKey = layer.key;
        renderGroupList();
      });
      card.append(name, button);
      groupList.append(card);
    }
  }

  function syncTreeSelection() {
    const posed = poseAt(bones(), previewMotion(), currentTime);
    if (!posed.some(bone => bone.name === selected)) {
      selected = posed[0]?.name || '';
    }
  }

  function refreshKeyControls() {
    const active = motion();
    const bone = active && selectedBone(poseAt(bones(), active, currentTime));
    if (!bone) {
      angleInput.value = '';
      if (rotSlider) rotSlider.value = '0';
      if (coordinate) coordinate.textContent = '';
      return;
    }
    const at = slotTime(currentTime);
    const displayAngle = boneAngleToDisplay(bone.angle);
    angleInput.value = String(displayAngle);
    if (rotSlider) rotSlider.value = String(displayAngle);
    if (coordinate) coordinate.textContent = `${bone.name} · ${Number(at.toFixed(3))}초 · X ${bone.pos[0]} · Y ${bone.pos[1]} · ${displayAngle}°`;
  }

  function updateViewModeBadge() {
    const mode = model.getVisibilityMode?.() || 'individual';
    const update = button => {
      if (!button) return;
      button.textContent = mode === 'group' ? '보기: 그룹' : '보기: 개별';
      button.title = `보기 방식 전환 (현재: ${mode === 'group' ? '그룹 보기' : '개별 보기'})`;
      button.setAttribute('aria-pressed', String(mode === 'group'));
    };
    update(viewModeButton);
  }

  function openBar(tool) {
    bar = tool;
    barPos.hidden = tool !== 'P';
    barRot.hidden = tool !== 'R';
  }

  function refresh() {
    const ready = Boolean(model.hasRig?.());
    if (!ready) openBar(null);
    loadedContent?.classList.toggle('motion-rig-empty', !ready);
    if (groupAddButton) groupAddButton.disabled = !ready;
    if ($('#motion-add')) $('#motion-add').disabled = !ready;
    if ($('#motion-open')) $('#motion-open').disabled = !ready;
    if ($('#motion-save')) $('#motion-save').disabled = !ready;
    if (!ready) {
      stop();
      refreshMotionPick();
      keys.render();
      syncTreeSelection();
      refreshKeyControls();
      for (const control of motionEditControls) control.disabled = true;
      $('#motion-drop').disabled = true;
      renderGroupList();
      return;
    }
    refreshMotionPick();
    syncTreeSelection();
    keys.render();
    refreshKeyControls();
    updateViewModeBadge();
    renderGroupList();
    render();
  }

  function updateKey(change, { quiet = false, before = null } = {}) {
    stop();
    const active = motion();
    if (!active) return;
    const at = slotTime(currentTime);
    const bone = selectedBone(poseAt(bones(), active, at));
    if (!bone) return;
    const snapshot = before || model.snapshot?.();
    const nextPose = { ...bone, pos: [...bone.pos], ...change };
    if (replaceMotion(setKey(active, bone.name, at, nextPose), quiet)) {
      if (quiet) {
        refreshKeyControls();
        render();
      } else {
        refresh();
        model.commit?.(snapshot);
      }
    }
  }

  function updateSettings(change) {
    stop();
    if (!motion()) return;
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
    const posed = poseAt(bones(), previewMotion(), currentTime);
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
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      stage.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        const hit = hitBone(event.clientX, event.clientY);
        if (hit) {
          stop(); selected = hit;
          if (!panel.hidden) model.selectBone?.(selected);
          if (!motion()) { refresh(); keys.reveal(selected); return; }
          const pose = selectedBone(poseAt(bones(), motion(), slotTime(currentTime)));
          dragBefore = model.snapshot?.();
          dragging = { x: event.clientX, y: event.clientY, pose: { ...pose, pos: [...pose.pos] }, changed: false };
          refresh();
          keys.reveal(selected);
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
        keys.render();
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
    const active = motion();
    if (!active) { stop(); return; }
    const elapsed = (now - startedAt) / 1000;
    if (!active.loop && elapsed >= active.length) {
      currentTime = Math.max(0, active.length - 1e-7); stop(); refresh(); return;
    }
    currentTime = active.loop ? elapsed % active.length : Math.min(elapsed, Math.max(0, active.length - 1e-7));
    keys.moveHead(true); refreshKeyControls(); render();
    animationFrame = requestAnimationFrame(playFrame);
  }

  function bindEvents() {
    $('#motion-bone-add')?.addEventListener('click', () => model.importSkeleton?.());
    groupAddButton?.addEventListener('click', () => model.importPreset?.());
    groupDeleteButton?.addEventListener('click', () => {
      const layer = (model.getPresetLayers?.() || []).find(item => item.key === selectedGroupKey);
      if (!layer) return;
      const before = model.snapshot?.();
      model.removePresetGroup?.(layer.key);
      selectedGroupKey = null;
      model.commit?.(before);
      app.toast('그룹 「' + layer.name + '」과 그림을 뺐습니다');
      refresh();
    });
    select.addEventListener('change', () => { stop(); currentName = select.value; currentTime = 0; refresh(); });
    $('#motion-add').addEventListener('click', () => {
      stop();
      const before = model.snapshot?.();
      const added = addMotion(animations(), defaultAnimations().walk);
      model.setAnimations(added.animations);
      currentName = added.name; currentTime = 0; app.changed(); refresh();
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
      if (!motion()) return;
      playing = true; currentTime = 0; startedAt = performance.now(); playButton.textContent = '■';
      animationFrame = requestAnimationFrame(playFrame);
    });
    onionButton.addEventListener('click', () => { onion = !onion; onionButton.setAttribute('aria-pressed', String(onion)); render(); });
    $('#motion-zoom-in').addEventListener('click', () => zoom(1));
    $('#motion-zoom-out').addEventListener('click', () => zoom(-1));
    $('#motion-zoom-fit').addEventListener('click', fit);
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomAt(cell + (e.deltaY < 0 ? 1 : -1), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    $('#motion-bar-pos-close').addEventListener('click', () => openBar(null));
    $('#motion-bar-rot-close').addEventListener('click', () => openBar(null));
    window.addEventListener('resize', () => { if (!panel.hidden) keys.render(); });
    viewModeButton?.addEventListener('click', () => {
      const before = model.snapshot?.();
      const current = model.getVisibilityMode?.() || 'individual';
      model.setVisibilityMode?.(current === 'group' ? 'individual' : 'group');
      updateViewModeBadge();
      render();
      model.commit?.(before);
    });
    angleInput.addEventListener('change', () => updateKey({ angle: displayAngleToBone(angleInput.value) }));
    if (rotSlider) {
      rotSlider.addEventListener('input', () => {
        if (!rotDragBefore) rotDragBefore = model.snapshot?.();
        updateKey({ angle: displayAngleToBone(rotSlider.value) }, { quiet: true, before: rotDragBefore });
      });
      rotSlider.addEventListener('change', () => {
        const before = rotDragBefore || model.snapshot?.();
        rotDragBefore = null;
        updateKey({ angle: displayAngleToBone(rotSlider.value) }, { before });
      });
    }
    const nudge = (dx, dy) => {
      const active = motion();
      if (!active) return;
      const bone = selectedBone(poseAt(bones(), active, slotTime(currentTime)));
      updateKey({ pos: [bone.pos[0] + dx, bone.pos[1] + dy] });
    };
    const nudgeAngle = change => {
      const active = motion();
      if (!active) return;
      const bone = selectedBone(poseAt(bones(), active, slotTime(currentTime)));
      updateKey({ angle: bone.angle + change });
    };
    $('#motion-bone-up').addEventListener('click', () => nudge(0, -1));
    $('#motion-bone-left').addEventListener('click', () => nudge(-1, 0));
    $('#motion-bone-down').addEventListener('click', () => nudge(0, 1));
    $('#motion-bone-right').addEventListener('click', () => nudge(1, 0));
    $('#motion-angle-minus').addEventListener('click', () => nudgeAngle(-15));
    $('#motion-angle-plus').addEventListener('click', () => nudgeAngle(15));
    $('#motion-save-gif').addEventListener('click', async () => {
      const active = motion();
      if (!active) return;
      const [width, height] = model.getSize();
      const restBones = applyRestPose(bones(), model.getRestPose?.()).bones;
      const made = renderMotionFrames(pieces(), bones(), active, width, height, model.getPresetLayers?.() || [], restBones);
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
        if (!Object.keys(activeMotions).length) return;
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
    show() { panel.hidden = false; refresh(); if (model.hasRig?.()) fit(); },
    hide() { stop(); keys.close(); panel.hidden = true; },
    refresh() { refresh(); },
    selectBone(name) {
      selected = bones().some(bone => bone.name === name) ? name : (bones()[0]?.name || '');
      syncTreeSelection();
      if (!panel.hidden) refresh();
    },
    getSelectedBone() { return selected; },
    shown() { if (!panel.hidden) fit(); },
  };
}
