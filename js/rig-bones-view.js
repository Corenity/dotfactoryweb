// 뼈대 단계 화면 — 뼈 나무, 위치·각도, 조각 연결·층과 미리보기를 다룹니다.
import { boneLabel, normalizeBones, applyRestPose, createRestPose, DEFAULT_BONES, addBone, removeBone, isValidBoneName } from './core/rig.js';
import { boneWorldTransforms, composeRig, worldDeltaToLocal, worldDeltaToBone } from './core/rig-render.js';
import { sortRigPiecesByLayers } from './core/preset-layers.js';
import { drawPixels, saveJson, pickFiles, baseName } from './io.js';
import { toSkeleton, parseSkeleton, applySkeletonToRig } from './core/skeleton.js';

const $ = selector => document.querySelector(selector);

export function mountRigBones(app, model) {
  const panel = $('#rig-bones-panel');
  const stage = $('#rig-bones-stage');
  const canvas = $('#rig-bones-canvas');
  const empty = $('#rig-bones-empty');
  const tree = $('#rig-bone-tree');
  const nameInput = $('#rig-bone-name');
  const parentSelect = $('#rig-bone-parent');
  const xInput = $('#rig-bone-x');
  const yInput = $('#rig-bone-y');
  const angleInput = $('#rig-bone-angle');
  const rotSlider = $('#rig-rot-slider');
  const rotMinus15 = $('#rig-rot-minus15');
  const rotPlus15 = $('#rig-rot-plus15');
  const zoomText = $('#rig-bones-zoom-text');
  const newNameInput = $('#rig-bone-new-name');
  const addBtn = $('#rig-bone-add');
  const deleteBtn = $('#rig-bone-delete');
  const saveSkeletonBtn = $('#rig-bones-save');
  const openSkeletonBtn = $('#rig-bones-open');

  const toolPosBtn = $('#rig-tool-pos');
  const toolRotBtn = $('#rig-tool-rot');
  const toolImgBtn = $('#rig-tool-img');
  const barPos = $('#rig-bar-pos');
  const barRot = $('#rig-bar-rot');
  const barImg = $('#rig-bar-img');
  const barDepth = $('#rig-bar-depth');
  const boneTools = $('#rig-bone-tools');
  const pieceTools = $('#rig-piece-tools');
  const pieceVisibleBtn = $('#rig-piece-visible');
  const pieceRemoveBtn = $('#rig-piece-remove');
  const pieceDepthBtn = $('#rig-piece-depth');
  const pieceDepthInput = $('#rig-piece-depth-input');
  const pieceDepthApply = $('#rig-piece-depth-apply');

  let selected = 'Torso';
  let selectedPieceIndex = null;
  let activeTool = 'P';
  let activePieceMenu = null;
  let cell = 4;
  let panX = 0, panY = 0;
  const pointers = new Map();
  let dragging = null;
  let dragBefore = null;
  let panning = null;
  let rotDragBefore = null;

  function bones() { return model.getBones(); }
  function pieces() { return model.getPieces(); }
  function selectedBone() { return bones().find(bone => bone.name === selected) || bones()[0]; }
  function selectedPiece() { return selectedPieceIndex == null ? null : pieces()[selectedPieceIndex] || null; }

  function notify() {
    model.changed();
    app.changed();
  }

  function replaceBones(candidate, renamedFrom = null) {
    try {
      const safe = normalizeBones(candidate);
      model.setBones(safe);
      if (renamedFrom) {
        for (const piece of pieces()) if (piece.bone === renamedFrom) piece.bone = selected;
        model.renameBone?.(renamedFrom, selected);
      }
      notify();
      refreshControls();
      render();
      return true;
    } catch (error) {
      app.toast(error.message);
      refreshControls();
      return false;
    }
  }

  function editSelected(change, { quiet = false } = {}) {
    const current = selectedBone();
    if (!current) return false;
    const candidate = bones().map(bone => bone.name === current.name ? { ...bone, pos: [...bone.pos], ...change } : { ...bone, pos: [...bone.pos] });
    try {
      model.setBones(normalizeBones(candidate));
      if (!quiet) notify();
      refreshControls();
      render();
      return true;
    } catch (error) {
      app.toast(error.message);
      refreshControls();
      return false;
    }
  }

  function editSelectedPiece(change, { quiet = false } = {}) {
    const piece = selectedPiece();
    if (!piece) return false;
    if (change.pos !== undefined) {
      piece.pos = [Math.round(change.pos[0]), Math.round(change.pos[1])];
    }
    if (change.rot !== undefined) {
      piece.rot = Math.round(change.rot);
    }
    if (change.zIndex !== undefined) {
      piece.zIndex = Math.round(change.zIndex);
    }
    if (!quiet) notify();
    refreshControls();
    render();
    return true;
  }

  function depthOf(bone, byName) {
    let depth = 0, current = bone;
    while (current.parent && depth < bones().length) { depth++; current = byName.get(current.parent); }
    return depth;
  }

  function renderTree() {
    if (!tree) return;
    tree.innerHTML = '';
    const byName = new Map(bones().map(bone => [bone.name, bone]));
    for (const bone of bones()) {
      const button = document.createElement('button');
      button.className = 'btn';
      button.style.paddingLeft = `${6 + depthOf(bone, byName) * 10}px`;
      button.textContent = `${bone.parent ? '↳ ' : ''}${bone.name}`;
      button.title = boneLabel(bone.name);
      button.setAttribute('aria-pressed', String(bone.name === selected && selectedPieceIndex == null));
      button.addEventListener('click', () => {
        selected = bone.name;
        selectedPieceIndex = null;
        activePieceMenu = null;
        refreshControls();
        render();
        model.changed?.();
      });
      tree.appendChild(button);

      pieces().forEach((piece, index) => {
        if (piece.bone !== bone.name) return;
        const pieceButton = document.createElement('button');
        pieceButton.className = `btn rig-piece-tree-row${piece.visible === false ? ' is-hidden' : ''}`;
        pieceButton.style.paddingLeft = `${16 + depthOf(bone, byName) * 10}px`;
        pieceButton.textContent = piece.name || piece.piece;
        pieceButton.title = `${piece.name || piece.piece} · 깊이 ${piece.zIndex ?? 0}`;
        pieceButton.setAttribute('aria-pressed', String(index === selectedPieceIndex));
        pieceButton.addEventListener('click', () => {
          selected = bone.name;
          selectedPieceIndex = index;
          activePieceMenu = null;
          refreshControls();
          render();
          model.changed?.();
        });
        tree.appendChild(pieceButton);
      });
    }
  }

  function updateSelectionMenus() {
    const piece = selectedPiece();
    if (boneTools) boneTools.hidden = !!piece;
    if (pieceTools) pieceTools.hidden = !piece;
    if (toolPosBtn) toolPosBtn.setAttribute('aria-pressed', String(activeTool === 'P'));
    if (toolRotBtn) toolRotBtn.setAttribute('aria-pressed', String(activeTool === 'R'));
    if (toolImgBtn) toolImgBtn.setAttribute('aria-pressed', String(activeTool === 'I'));
    if (barPos) barPos.hidden = activeTool !== 'P' || (piece && activePieceMenu === 'depth');
    if (barRot) barRot.hidden = activeTool !== 'R' || (piece && activePieceMenu === 'depth');
    if (barImg) barImg.hidden = activeTool !== 'I' || (piece && activePieceMenu === 'depth');
    if (barDepth) barDepth.hidden = !piece || activePieceMenu !== 'depth';
    if (pieceVisibleBtn && piece) pieceVisibleBtn.textContent = piece.visible === false ? '보이기' : '숨김';
    if (pieceDepthInput && piece) pieceDepthInput.value = String(piece.zIndex ?? 0);
  }

  function switchTool(tool) {
    activeTool = tool;
    activePieceMenu = null;
    updateSelectionMenus();
  }

  function refreshControls() {
    if (selectedPieceIndex != null && !pieces()[selectedPieceIndex]) selectedPieceIndex = null;
    const bone = selectedBone();
    if (!bone) return;
    selected = bone.name;
    const piece = selectedPiece();
    if (nameInput) nameInput.value = bone.name;
    if (piece) {
      if (xInput) xInput.value = String(piece.pos?.[0] ?? 0);
      if (yInput) yInput.value = String(piece.pos?.[1] ?? 0);
      if (angleInput) angleInput.value = String(piece.rot ?? 0);
      if (rotSlider) rotSlider.value = String(piece.rot ?? 0);
    } else {
      if (xInput) xInput.value = String(bone.pos[0]);
      if (yInput) yInput.value = String(bone.pos[1]);
      if (angleInput) angleInput.value = String(bone.angle);
      if (rotSlider) rotSlider.value = String(bone.angle);
    }
    const badge = $('#rig-selected-bone-badge');
    if (badge) {
      badge.textContent = piece
        ? `선택: ${piece.name || piece.piece} (${boneLabel(bone.name)})`
        : `선택: ${boneLabel(bone.name)}`;
    }
    if (parentSelect) {
      parentSelect.innerHTML = '<option value="">없음 (Skeleton2D)</option>';
      for (const other of bones()) {
        if (other.name === bone.name) continue;
        const option = document.createElement('option');
        option.value = other.name;
        option.textContent = boneLabel(other.name);
        parentSelect.appendChild(option);
      }
      parentSelect.value = bone.parent || '';
    }
    updateSelectionMenus();
    renderTree();
  }

  function fit() {
    const [width, height] = model.getSize();
    const stageWidth = stage.clientWidth || 200, stageHeight = stage.clientHeight || 256;
    cell = Math.max(1, Math.round(stageHeight / height));
    panX = Math.round((stageWidth - width * cell) / 2);
    panY = Math.round((stageHeight - height * cell) / 2);
    render();
  }

  function zoom(direction) {
    const next = Math.max(1, Math.min(16, cell + direction));
    if (next === cell) return;
    const cx = (stage.clientWidth || 200) / 2, cy = (stage.clientHeight || 200) / 2;
    const x = (cx - panX) / cell, y = (cy - panY) / cell;
    cell = next; panX = Math.round(cx - x * cell); panY = Math.round(cy - y * cell);
    render();
  }

  function render() {
    const [width, height] = model.getSize();
    const restBones = applyRestPose(bones(), model.getRestPose?.()).bones;
    const layers = model.getPresetLayers?.() || [];
    const mode = model.getVisibilityMode?.() || 'individual';
    const visiblePieces = sortRigPiecesByLayers(pieces(), layers, { screen: true, visibilityMode: mode });
    const preview = composeRig(visiblePieces, bones(), width, height, restBones, layers);
    drawPixels(canvas, preview, cell, model.getBackdrop());
    canvas.style.transform = `translate(${panX}px, ${panY}px)`;
    if (zoomText) zoomText.textContent = `${cell}배`;
    if (empty) empty.hidden = pieces().length > 0;

    const ctx = canvas.getContext('2d');
    const world = boneWorldTransforms(bones());
    ctx.lineWidth = Math.max(2, cell / 2);
    ctx.strokeStyle = '#ffd60a';
    for (const bone of bones()) {
      const point = world.get(bone.name);
      if (!bone.parent) continue;
      const parent = world.get(bone.parent);
      ctx.beginPath(); ctx.moveTo(parent.x * cell, parent.y * cell); ctx.lineTo(point.x * cell, point.y * cell); ctx.stroke();
    }
    for (const bone of bones()) {
      const point = world.get(bone.name);
      ctx.beginPath();
      ctx.arc(point.x * cell, point.y * cell, bone.name === selected ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = bone.name === selected ? '#32d74b' : '#ffffff';
      ctx.fill(); ctx.strokeStyle = '#111114'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  function hitBone(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    const x = clientX - rect.left - panX, y = clientY - rect.top - panY;
    const world = boneWorldTransforms(bones());
    let best = null, bestDistance = 22 * 22;
    for (const bone of bones()) {
      const point = world.get(bone.name);
      const dx = point.x * cell - x, dy = point.y * cell - y, distance = dx * dx + dy * dy;
      if (distance <= bestDistance) { best = bone.name; bestDistance = distance; }
    }
    return best;
  }

  function bindPointers() {
    stage.addEventListener('pointerdown', event => {
      stage.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        const piece = selectedPiece();
        if (piece && activeTool === 'P') {
          dragBefore = model.snapshot?.();
          dragging = { type: 'piece', x: event.clientX, y: event.clientY, pos: [...(piece.pos || [0, 0])], changed: false };
        } else {
          const hit = hitBone(event.clientX, event.clientY);
          if (hit) {
            selected = hit;
            selectedPieceIndex = null;
            activePieceMenu = null;
            refreshControls();
            render();
            model.changed?.();
            const bone = selectedBone();
            dragBefore = model.snapshot?.();
            dragging = { type: 'bone', x: event.clientX, y: event.clientY, pos: [...bone.pos], changed: false };
          }
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
        if (dragging.type === 'piece') {
          const piece = selectedPiece();
          if (piece) {
            const [localX, localY] = worldDeltaToBone(bones(), piece.bone, dx, dy);
            const pos = [Math.round(dragging.pos[0] + localX), Math.round(dragging.pos[1] + localY)];
            dragging.changed = true;
            editSelectedPiece({ pos }, { quiet: true });
          }
        } else {
          const [localX, localY] = worldDeltaToLocal(bones(), selected, dx, dy);
          const pos = [Math.round(dragging.pos[0] + localX), Math.round(dragging.pos[1] + localY)];
          dragging.changed = true;
          editSelected({ pos }, { quiet: true });
        }
      }
    });

    const end = event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (dragging?.changed) {
        notify();
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

  function bindEvents() {
    $('#rig-bones-zoom-in')?.addEventListener('click', () => zoom(1));
    $('#rig-bones-zoom-out')?.addEventListener('click', () => zoom(-1));
    $('#rig-bones-zoom-fit')?.addEventListener('click', fit);

    toolPosBtn?.addEventListener('click', () => switchTool('P'));
    toolRotBtn?.addEventListener('click', () => switchTool('R'));
    toolImgBtn?.addEventListener('click', () => switchTool('I'));

    pieceVisibleBtn?.addEventListener('click', () => {
      const piece = selectedPiece();
      if (!piece) return;
      const before = model.snapshot?.();
      piece.visible = piece.visible === false;
      model.setVisibilityMode?.('individual');
      const badge = $('#rig-view-mode-btn');
      if (badge) {
        badge.textContent = '보기: 개별';
        badge.setAttribute('aria-pressed', 'false');
      }
      notify();
      refreshControls();
      render();
      model.commit?.(before);
    });

    pieceRemoveBtn?.addEventListener('click', () => {
      const piece = selectedPiece();
      if (!piece) return;
      const before = model.snapshot?.();
      const boneName = piece.bone;
      pieces().splice(selectedPieceIndex, 1);
      selected = boneName;
      selectedPieceIndex = null;
      activePieceMenu = null;
      notify();
      refreshControls();
      render();
      model.commit?.(before);
    });

    pieceDepthBtn?.addEventListener('click', () => {
      if (!selectedPiece()) return;
      activePieceMenu = 'depth';
      updateSelectionMenus();
      pieceDepthInput?.focus();
    });

    pieceDepthApply?.addEventListener('click', () => {
      const piece = selectedPiece();
      if (!piece || !pieceDepthInput) return;
      const before = model.snapshot?.();
      piece.zIndex = Math.round(Number(pieceDepthInput.value) || 0);
      activePieceMenu = null;
      notify();
      refreshControls();
      render();
      model.commit?.(before);
    });

    if (nameInput) {
      nameInput.addEventListener('change', () => {
        const oldName = selectedBone().name, next = nameInput.value.trim();
        if (!next || next === oldName) { refreshControls(); return; }
        const before = model.snapshot?.();
        const candidate = bones().map(bone => ({ ...bone, pos: [...bone.pos], name: bone.name === oldName ? next : bone.name, parent: bone.parent === oldName ? next : bone.parent }));
        selected = next;
        if (!replaceBones(candidate, oldName)) selected = oldName;
        else model.commit?.(before);
      });
    }

    if (parentSelect) {
      parentSelect.addEventListener('change', () => {
        const before = model.snapshot?.();
        if (editSelected({ parent: parentSelect.value || null })) model.commit?.(before);
      });
    }

    const updatePosition = () => {
      const before = model.snapshot?.();
      const piece = selectedPiece();
      if (piece) {
        if (editSelectedPiece({ pos: [Number(xInput.value), Number(yInput.value)] })) model.commit?.(before);
      } else {
        if (editSelected({ pos: [Number(xInput.value), Number(yInput.value)] })) model.commit?.(before);
      }
    };
    if (xInput) xInput.addEventListener('change', updatePosition);
    if (yInput) yInput.addEventListener('change', updatePosition);

    if (angleInput) {
      angleInput.addEventListener('change', () => {
        const before = model.snapshot?.();
        const piece = selectedPiece();
        const val = Number(angleInput.value);
        if (piece) {
          if (editSelectedPiece({ rot: val })) model.commit?.(before);
        } else {
          if (editSelected({ angle: val })) model.commit?.(before);
        }
      });
    }

    if (rotSlider) {
      rotSlider.addEventListener('input', () => {
        if (!rotDragBefore) rotDragBefore = model.snapshot?.();
        const piece = selectedPiece();
        const val = Number(rotSlider.value);
        if (piece) {
          editSelectedPiece({ rot: val }, { quiet: true });
        } else {
          editSelected({ angle: val }, { quiet: true });
        }
        if (angleInput) angleInput.value = rotSlider.value;
      });
      rotSlider.addEventListener('change', () => {
        const before = rotDragBefore || model.snapshot?.();
        rotDragBefore = null;
        const piece = selectedPiece();
        const val = Number(rotSlider.value);
        if (piece) {
          if (editSelectedPiece({ rot: val })) model.commit?.(before);
        } else {
          if (editSelected({ angle: val })) model.commit?.(before);
        }
      });
    }

    if (rotMinus15) {
      rotMinus15.addEventListener('click', () => {
        const piece = selectedPiece();
        if (piece) {
          const before = model.snapshot?.();
          const nextRot = Math.round((piece.rot || 0) - 15);
          if (editSelectedPiece({ rot: nextRot })) model.commit?.(before);
          return;
        }
        const bone = selectedBone();
        if (!bone) return;
        const before = model.snapshot?.();
        const nextAngle = Math.round(bone.angle - 15);
        if (editSelected({ angle: nextAngle })) model.commit?.(before);
      });
    }

    if (rotPlus15) {
      rotPlus15.addEventListener('click', () => {
        const piece = selectedPiece();
        if (piece) {
          const before = model.snapshot?.();
          const nextRot = Math.round((piece.rot || 0) + 15);
          if (editSelectedPiece({ rot: nextRot })) model.commit?.(before);
          return;
        }
        const bone = selectedBone();
        if (!bone) return;
        const before = model.snapshot?.();
        const nextAngle = Math.round(bone.angle + 15);
        if (editSelected({ angle: nextAngle })) model.commit?.(before);
      });
    }

    const nudge = (dx, dy) => {
      const piece = selectedPiece();
      if (piece) {
        const before = model.snapshot?.();
        const curPos = piece.pos || [0, 0];
        const [localDx, localDy] = worldDeltaToBone(bones(), piece.bone, dx, dy);
        const nextPos = [Math.round(curPos[0] + localDx), Math.round(curPos[1] + localDy)];
        if (editSelectedPiece({ pos: nextPos })) model.commit?.(before);
        return;
      }
      const bone = selectedBone();
      if (!bone) return;
      const before = model.snapshot?.();
      if (editSelected({ pos: [bone.pos[0] + dx, bone.pos[1] + dy] })) model.commit?.(before);
    };
    $('#rig-bone-up')?.addEventListener('click', () => nudge(0, -1));
    $('#rig-bone-left')?.addEventListener('click', () => nudge(-1, 0));
    $('#rig-bone-down')?.addEventListener('click', () => nudge(0, 1));
    $('#rig-bone-right')?.addEventListener('click', () => nudge(1, 0));

    $('#rig-bones-reset-rest')?.addEventListener('click', () => {
      const { bones: nextBones, changed } = applyRestPose(bones(), model.getRestPose?.());
      if (!changed) return;
      const before = model.snapshot?.();
      model.setBones(nextBones);
      notify();
      refreshControls();
      render();
      model.commit?.(before);
    });

    $('#rig-bones-save-rest')?.addEventListener('click', () => {
      const before = model.snapshot?.();
      const newRestPose = createRestPose(bones());
      model.setRestPose?.(newRestPose);
      notify();
      app.toast('초기값을 저장했습니다');
      model.commit?.(before);
    });

    if (addBtn && newNameInput) {
      addBtn.addEventListener('click', () => {
        const name = (newNameInput.value || '').trim();
        if (!name) {
          app.toast('뼈 이름을 넣어 주세요');
          return;
        }
        if (!isValidBoneName(name)) {
          app.toast('뼈 이름은 영문, 숫자, _ 만 쓸 수 있습니다');
          return;
        }
        if (bones().some(b => b.name === name)) {
          app.toast(`뼈 이름 「${name}」이 이미 있습니다`);
          return;
        }
        const before = model.snapshot?.();
        const parent = selectedBone() ? selectedBone().name : null;
        try {
          const nextBones = addBone(bones(), { name, parent });
          model.setBones(nextBones);
          selected = name;
          newNameInput.value = '';
          notify();
          refreshControls();
          render();
          model.commit?.(before);
          app.toast(`뼈 「${name}」을 더했습니다`);
        } catch (err) {
          app.toast(err.message);
        }
      });
      newNameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') addBtn.click();
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        const current = selectedBone();
        if (!current) return;
        if (bones().length <= 1) {
          app.toast('마지막 뼈는 지울 수 없습니다');
          return;
        }
        const isDefault = DEFAULT_BONES.some(b => b.name === current.name);
        const before = model.snapshot?.();
        try {
          const result = removeBone({
            bones: bones(),
            pieces: pieces(),
            animations: model.getAnimations?.(),
            restPose: model.getRestPose?.(),
          }, current.name);

          model.setBones(result.bones);
          if (model.setRestPose) model.setRestPose(result.restPose);
          if (model.setAnimations && result.animations) model.setAnimations(result.animations);
          const currentPieces = pieces();
          for (let i = 0; i < currentPieces.length; i++) {
            if (result.pieces[i]) currentPieces[i].bone = result.pieces[i].bone;
          }

          selected = result.bones.some(b => b.name === current.parent) ? current.parent : result.bones[0].name;
          notify();
          refreshControls();
          render();
          model.commit?.(before);

          let message = `뼈 「${current.name}」을 지웠습니다`;
          if (isDefault) message += '. project-c 고도 뼈와 달라집니다';
          if (result.reparentedChildren && result.reparentedChildren.length > 0) {
            message += '. 자식 뼈의 움직임 키는 지금 값 그대로 둡니다(부모가 바뀌어 보이는 자리가 달라질 수 있습니다)';
          }
          app.toast(message);
        } catch (err) {
          app.toast(err.message);
        }
      });
    }

    if (saveSkeletonBtn) {
      saveSkeletonBtn.addEventListener('click', async () => {
        const skeletonName = model.getSkeletonName?.() || 'character_skeleton';
        const skeletonObj = toSkeleton({
          canvas: model.getSize?.() || [72, 64],
          bones: bones(),
        });
        const fileName = `${skeletonName}.json`;
        const result = await saveJson(fileName, skeletonObj);
        if (result !== 'cancelled') {
          app.toast(`「${fileName}」으로 저장했습니다`);
        }
      });
    }

    if (openSkeletonBtn) {
      openSkeletonBtn.addEventListener('click', async () => {
        try {
          const [file] = await pickFiles({ accept: '.json,application/json,text/plain' });
          if (!file) return;
          const skeletonObj = parseSkeleton(JSON.parse(await file.text()));
          const before = model.snapshot?.();
          const result = applySkeletonToRig({
            skeleton: skeletonObj,
            pieces: pieces(),
            animations: model.getAnimations?.(),
            selectedBone: selected,
            preserveMissingPieces: true,
          });
          model.setBones(result.bones);
          if (model.setRestPose) model.setRestPose(result.restPose);
          if (model.setAnimations && result.animations) model.setAnimations(result.animations);
          model.setSkeletonName?.(baseName(file.name));
          const curPieces = pieces();
          for (let i = 0; i < curPieces.length; i++) {
            if (result.pieces[i]) curPieces[i].bone = result.pieces[i].bone;
          }
          selected = result.selectedBone || result.bones[0]?.name || 'Torso';
          notify();
          refreshControls();
          render();
          model.commit?.(before);

          let msg = '뼈 파일을 불러왔습니다';
          const notes = [];
          if (result.movedPiecesCount > 0) notes.push(`조각 ${result.movedPiecesCount}개 이동`);
          if (result.droppedKeyCount > 0) notes.push(`키 ${result.droppedKeyCount}개 제외`);
          if (notes.length > 0) msg += ` (${notes.join(', ')})`;
          app.toast(msg);
        } catch (err) {
          app.toast(err.message || '뼈 파일을 열 수 없습니다');
        }
      });
    }

    bindPointers();
  }

  bindEvents();
  switchTool('P');
  refreshControls();

  return {
    show() { panel.hidden = false; refreshControls(); fit(); },
    hide() { panel.hidden = true; },
    refresh() { refreshControls(); render(); },
    getSelectedBone() { return selected; },
    shown() { if (!panel.hidden) fit(); },
    switchTool,
  };
}
