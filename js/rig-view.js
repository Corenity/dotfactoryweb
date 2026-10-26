// 뼈대·키잡기 화면 — 뼈, 붙인 그림, 움직임과 옛 작업 파일 호환을 다룹니다.
import { toProject, parseProject, cloneDefaultBones, defaultAnimations, normalizeAnimations, addBone, isValidBoneName } from './core/rig.js';
import { KEY, toHex } from './core/paint.js';
import { pickFiles, readDataUrl, saveJson, baseName } from './io.js';
import { RigHistory, cloneRigState } from './core/rig-history.js';
import {
  workingRigToRoleState, roleRigToWorkingState, workingMotionToRoleState, roleMotionToWorkingState,
} from './core/role-flow.js';
import { toSkeleton, parseSkeleton, replaceSkeletonInRig, skeletonImportState } from './core/skeleton.js';
import { mountRigBones } from './rig-bones-view.js';
import { mountRigPreset, importPresetFile } from './rig-preset-view.js';
import { mountMotion } from './motion-view.js';
import { projectFromGodotTscn, projectFromGodotZip } from './core/godot-export.js';
import { normalizeRigLayerState, migrateLegacyLayersToDepth } from './core/preset-layers.js';
import { CURRENT_PROFILE } from './core/profile.js';

const $ = sel => document.querySelector(sel);

export function validateBoneAddition(bones, name, parent = null) {
  const cleanName = String(name || '').trim();
  if (!cleanName) return '뼈 이름을 넣어 주세요';
  if (!isValidBoneName(cleanName)) return '뼈 이름은 영문, 숫자, _ 만 쓸 수 있습니다';
  if ((bones || []).some(bone => bone.name === cleanName)) return `뼈 이름 「${cleanName}」이 이미 있습니다`;
  if (parent && !(bones || []).some(bone => bone.name === parent)) return `부모 뼈 「${parent}」를 찾을 수 없습니다`;
  return '';
}

export function boneParentChoices(bones, selectedBone = null) {
  const safeBones = Array.isArray(bones) ? bones : [];
  const selected = safeBones.some(bone => bone.name === selectedBone) ? selectedBone : '';
  return {
    selected,
    choices: [
      { value: '', label: '부모 없음' },
      ...safeBones.map(bone => ({ value: bone.name, label: bone.name })),
    ],
  };
}

export function resolveRigImageMenuState(bones, selectedBone = null) {
  const bone = (bones || []).find(item => item.name === selectedBone);
  return {
    label: bone ? `${bone.name}에 이미지 추가` : '이미지 추가',
    disabled: !bone,
  };
}

export function rigProjectWithoutAnimations(project) {
  return { ...project, animations: {} };
}

export function replaceRigProjectKeepingAnimations(current, incoming, selectedBone = null) {
  const result = replaceSkeletonInRig({
    skeleton: toSkeleton({ canvas: incoming.canvas, bones: incoming.bones }),
    pieces: incoming.pieces,
    animations: current.animations,
    presetLayers: incoming.presetLayers,
    selectedBone,
  });
  return {
    project: {
      ...incoming,
      bones: result.bones,
      pieces: result.pieces,
      presetLayers: result.presetLayers,
      animations: result.animations,
    },
    selectedBone: result.selectedBone,
    droppedKeyCount: result.droppedKeyCount,
  };
}

// 뼈대 탭과 키잡기 사본이 같이 쓰는 뼈 「불러오기」 — 대상 상태만 다르게 넘깁니다.
export async function importSkeletonFile(app, target) {
  try {
    const [file] = await pickFiles({ accept: '.json,application/json,text/plain' });
    if (!file) return;
    const skeleton = parseSkeleton(JSON.parse(await file.text()));
    app.warnCanvas?.(skeleton.canvas, '뼈대 파일');
    const before = target.snapshot();
    const { state, result } = skeletonImportState(target.getState(), skeleton, {
      selectedBone: target.getSelectedBone?.(),
      skeletonName: baseName(file.name),
    });
    target.setState(state);
    target.finish(before, result.selectedBone || result.bones[0]?.name || null);
    app.toast(`뼈 파일을 불러왔습니다 (그림 ${result.removedPieceCount}개 삭제, 키 ${result.droppedKeyCount}개 삭제)`);
  } catch (error) {
    app.toast(error.message || '뼈 파일을 열 수 없습니다');
  }
}

export function emptyMotionRigState() {
  return cloneRigState({
    canvas: CURRENT_PROFILE.canvas,
    baseTitle: '캐릭터',
    skeletonName: CURRENT_PROFILE.skeletonName,
    presetMeta: { id: 'preset', name: '새 프리셋', kind: 'bare' },
    presetLayers: [],
    pieces: [],
    bones: [],
    animations: defaultAnimations(),
    restPose: null,
    visibilityMode: 'individual',
  });
}

export function removeMotionPresetGroup(state, layerKey) {
  const next = cloneRigState(state);
  if (!next.presetLayers.some(layer => layer.key === layerKey)) return next;
  next.presetLayers = next.presetLayers.filter(layer => layer.key !== layerKey);
  next.pieces = next.pieces.filter(piece => piece.presetLayerKey !== layerKey);
  return next;
}

export function mountRig(app) {
  let [canvasWidth, canvasHeight] = CURRENT_PROFILE.canvas;
  let pieces = [];
  let bones = cloneDefaultBones();
  let restPose = null;
  let animations = defaultAnimations();
  let currentSlot = 'bare';
  let currentItem = '맨몸';
  let skeletonName = CURRENT_PROFILE.skeletonName;
  let presetMeta = { id: 'preset', name: '새 프리셋', kind: 'bare' };
  let presetLayers = [];
  let selectedPresetLayerKey = null;
  let visibilityMode = 'individual';
  let openLegacyOptions = null;
  let lastReplacement = null;
  let motionRig = emptyMotionRigState();
  let currentStep = 'rig';

  const undoBtn = $('#rig-undo');
  const redoBtn = $('#rig-redo');
  const importReport = $('#rig-import-report');

  const history = new RigHistory();
  const motionHistory = new RigHistory();

  function snapshot() {
    return cloneRigState({
      canvas: [canvasWidth, canvasHeight],
      baseTitle: currentItem,
      skeletonName,
      presetMeta,
      presetLayers,
      baseImage: null,
      pieces,
      bones,
      animations,
      restPose,
      visibilityMode,
    });
  }

  function motionSnapshot() {
    return cloneRigState(motionRig);
  }

  function updateUndoRedo() {
    const activeHistory = currentStep === 'motion' ? motionHistory : history;
    if (undoBtn) undoBtn.disabled = !activeHistory.canUndo;
    if (redoBtn) redoBtn.disabled = !activeHistory.canRedo;
  }

  function recordChange(before) {
    if (!before) return;
    if (history.push(before, snapshot())) {
      updateUndoRedo();
      app.changed();
    }
  }

  function recordMotionChange(before) {
    if (!before) return;
    if (motionHistory.push(before, motionSnapshot())) {
      updateUndoRedo();
      app.changed();
    }
  }

  function finishMotionImport(before, selectedBone = null) {
    if (selectedBone) motionView?.selectBone?.(selectedBone);
    motionView?.refresh();
    motionView?.shown?.();
    recordMotionChange(before);
  }

  function applySnapshot(snap) {
    if (!snap) return;
    const copy = cloneRigState(snap);
    canvasWidth = copy.canvas[0];
    canvasHeight = copy.canvas[1];
    currentItem = copy.baseTitle;
    skeletonName = copy.skeletonName;
    presetMeta = copy.presetMeta;
    presetLayers = copy.presetLayers;
    if (selectedPresetLayerKey && !presetLayers.some(layer => layer.key === selectedPresetLayerKey)) selectedPresetLayerKey = null;
    pieces = copy.pieces;
    bones = copy.bones;
    animations = copy.animations;
    restPose = copy.restPose || null;
    visibilityMode = copy.visibilityMode || 'individual';
    bonesView?.refresh();
    presetView?.refresh();
    updateUndoRedo();
    app.changed();
  }

  function applyMotionSnapshot(snap) {
    if (!snap) return;
    motionRig = cloneRigState(snap);
    motionView?.refresh();
    updateUndoRedo();
    app.changed();
  }

  function undo() {
    if (currentStep === 'motion') {
      const prev = motionHistory.undo(motionSnapshot());
      if (prev) applyMotionSnapshot(prev);
      return;
    }
    const prev = history.undo(snapshot());
    if (prev) applySnapshot(prev);
  }

  function redo() {
    if (currentStep === 'motion') {
      const next = motionHistory.redo(motionSnapshot());
      if (next) applyMotionSnapshot(next);
      return;
    }
    const next = history.redo(snapshot());
    if (next) applySnapshot(next);
  }

  function mountBonePanel() {
    const plusWrap = $('.rig-bone-plus-wrap');
    const plusBtn = $('#rig-bone-add');
    const plusMenu = $('#rig-bone-plus-menu');
    const createBtn = $('#rig-bone-create');
    const imageBtn = $('#rig-bone-image');
    const importBtn = $('#rig-bone-import');
    const saveBtn = $('#rig-bone-save');
    const addPop = $('#rig-bone-add-pop');
    const closeBtn = $('#rig-bone-add-close');
    const cancelBtn = $('#rig-bone-add-cancel');
    const confirmBtn = $('#rig-bone-add-confirm');
    const nameInput = $('#rig-bone-add-name');
    const parentSelect = $('#rig-bone-add-parent');
    const errorText = $('#rig-bone-add-error');

    function closeMenu() {
      if (plusMenu) plusMenu.hidden = true;
      plusBtn?.setAttribute('aria-expanded', 'false');
    }

    function positionMenu() {
      if (!plusBtn || !plusMenu || plusMenu.hidden) return;
      const buttonRect = plusBtn.getBoundingClientRect();
      const left = Math.max(4, Math.min(buttonRect.left, window.innerWidth - plusMenu.offsetWidth - 4));
      const top = Math.max(4, buttonRect.top - plusMenu.offsetHeight - 4);
      plusMenu.style.left = `${left}px`;
      plusMenu.style.top = `${top}px`;
    }

    function showError(message = '') {
      if (!errorText) return;
      errorText.textContent = message;
      errorText.hidden = !message;
    }

    function fillParentChoices() {
      if (!parentSelect) return;
      const state = boneParentChoices(bones, bonesView?.getSelectedBone?.());
      parentSelect.innerHTML = '';
      for (const choice of state.choices) {
        const option = document.createElement('option');
        option.value = choice.value;
        option.textContent = choice.label;
        parentSelect.append(option);
      }
      parentSelect.value = state.selected;
    }

    function openAddModal() {
      closeMenu();
      fillParentChoices();
      if (nameInput) nameInput.value = '';
      showError();
      if (addPop) addPop.hidden = false;
      nameInput?.focus();
    }

    function closeAddModal() {
      if (addPop) addPop.hidden = true;
      showError();
    }

    function finishChange(before, selectedBone) {
      bonesView?.selectBone?.(selectedBone);
      presetView?.refresh();
      motionView?.refresh();
      recordChange(before);
    }

    plusBtn?.addEventListener('click', event => {
      event.stopPropagation();
      const willOpen = Boolean(plusMenu?.hidden);
      const imageState = resolveRigImageMenuState(bones, bonesView?.getSelectedBone?.());
      if (imageBtn) {
        imageBtn.textContent = imageState.label;
        imageBtn.disabled = imageState.disabled;
      }
      if (plusMenu) plusMenu.hidden = !willOpen;
      plusBtn.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) positionMenu();
    });
    plusMenu?.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', event => {
      if (!plusWrap?.contains(event.target)) closeMenu();
    });
    window.addEventListener('resize', positionMenu);

    createBtn?.addEventListener('click', openAddModal);
    imageBtn?.addEventListener('click', () => {
      closeMenu();
      if (!imageBtn.disabled) presetView?.addPhonePng?.();
    });
    closeBtn?.addEventListener('close', closeAddModal);
    closeBtn?.addEventListener('click', closeAddModal);
    cancelBtn?.addEventListener('click', closeAddModal);

    function addFromModal() {
      const name = String(nameInput?.value || '').trim();
      const parent = parentSelect?.value || null;
      const message = validateBoneAddition(bones, name, parent);
      if (message) {
        showError(message);
        return;
      }
      const before = snapshot();
      try {
        bones = addBone(bones, { name, parent });
        closeAddModal();
        finishChange(before, name);
        app.toast(`뼈 「${name}」을 더했습니다`);
      } catch (error) {
        showError(error.message || '뼈를 추가할 수 없습니다');
      }
    }

    confirmBtn?.addEventListener('click', addFromModal);
    nameInput?.addEventListener('keydown', event => {
      if (event.key === 'Enter') addFromModal();
    });

    importBtn?.addEventListener('click', () => {
      closeMenu();
      importSkeletonFile(app, {
        getState: () => ({ pieces, animations, presetLayers, skeletonName }),
        setState: next => {
          bones = next.bones;
          pieces = next.pieces;
          presetLayers = next.presetLayers;
          restPose = next.restPose;
          animations = next.animations;
          skeletonName = next.skeletonName;
        },
        snapshot: () => snapshot(),
        getSelectedBone: () => bonesView?.getSelectedBone?.(),
        finish: finishChange,
      });
    });

    saveBtn?.addEventListener('click', async () => {
      const fileName = `${skeletonName || CURRENT_PROFILE.skeletonName}.json`;
      const skeleton = toSkeleton({ canvas: [canvasWidth, canvasHeight], bones });
      const result = await saveJson(fileName, skeleton);
      if (result !== 'cancelled') app.toast(`「${fileName}」으로 저장했습니다`);
    });
  }

  let bonesView = null, presetView = null, motionView = null;
  bonesView = mountRigBones(app, {
    getBones: () => bones,
    setBones: value => { bones = value; },
    getRestPose: () => restPose,
    setRestPose: value => { restPose = value; },
    getAnimations: () => animations,
    setAnimations: value => { animations = value; },
    getPieces: () => pieces,
    setPieces: value => { pieces = value; },
    getPresetLayers: () => presetLayers,
    setPresetLayers: value => { presetLayers = value; },
    getVisibilityMode: () => visibilityMode,
    setVisibilityMode: value => { visibilityMode = value === 'group' ? 'group' : 'individual'; },
    getSize: () => [canvasWidth, canvasHeight],
    getBackdrop: () => toHex(KEY),
    changed: () => presetView?.refresh(),
    renameBone: (from, to) => {
      for (const motion of Object.values(animations)) {
        if (!(from in motion.tracks)) continue;
        motion.tracks[to] = motion.tracks[from];
        delete motion.tracks[from];
      }
    },
    getItem: () => currentItem,
    snapshot: () => snapshot(),
    commit: before => recordChange(before),
    getSkeletonName: () => skeletonName,
    setSkeletonName: value => { skeletonName = String(value || CURRENT_PROFILE.skeletonName); },
  });
  presetView = mountRigPreset(app, {
    getBones: () => bones,
    getPieces: () => pieces,
    setPieces: value => { pieces = value; },
    getPresetLayers: () => presetLayers,
    setPresetLayers: value => { presetLayers = value; },
    getVisibilityMode: () => visibilityMode,
    setVisibilityMode: value => { visibilityMode = value === 'group' ? 'group' : 'individual'; },
    getSelectedPresetLayerKey: () => selectedPresetLayerKey,
    setSelectedPresetLayerKey: value => { selectedPresetLayerKey = value || null; },
    getSize: () => [canvasWidth, canvasHeight],
    setSize: value => { canvasWidth = value[0]; canvasHeight = value[1]; },
    getPresetMeta: () => ({ ...presetMeta }),
    setPresetMeta: value => { presetMeta = { ...value }; },
    getSkeletonName: () => skeletonName,
    getSelectedBone: () => bonesView?.getSelectedBone?.(),
    snapshot: () => snapshot(),
    commit: before => recordChange(before),
    refreshViews: () => {
      bonesView?.refresh();
      presetView?.refresh();
    },
  });
  motionView = mountMotion(app, {
    hasRig: () => motionRig.bones.length > 0,
    getBones: () => motionRig.bones,
    getRestPose: () => motionRig.restPose,
    getPieces: () => motionRig.pieces,
    getPresetLayers: () => motionRig.presetLayers,
    setPresetLayers: value => { motionRig.presetLayers = value; },
    removePresetGroup: layerKey => { motionRig = removeMotionPresetGroup(motionRig, layerKey); },
    getVisibilityMode: () => motionRig.visibilityMode,
    setVisibilityMode: value => { motionRig.visibilityMode = value === 'group' ? 'group' : 'individual'; },
    getAnimations: () => motionRig.animations,
    setAnimations: value => { motionRig.animations = normalizeAnimations(value, motionRig.bones); },
    getSize: () => motionRig.canvas,
    getBackdrop: () => toHex(KEY),
    getItem: () => motionRig.baseTitle,
    snapshot: () => motionSnapshot(),
    commit: before => recordMotionChange(before),
    importSkeleton: () => importSkeletonFile(app, {
      getState: () => motionRig,
      setState: next => { motionRig = next; },
      snapshot: () => motionSnapshot(),
      getSelectedBone: () => motionView?.getSelectedBone?.(),
      finish: finishMotionImport,
    }),
    importPreset: () => importPresetFile(app, {
      getState: () => motionRig,
      setState: next => { motionRig = next; },
      snapshot: () => motionSnapshot(),
      finish: before => finishMotionImport(before),
    }),
  });
  mountBonePanel();

  // 작업 열기와 자동 복원의 단일 통합 함수
  async function loadProjectData(proj, role = null, { keepAnimations = false, recordHistory = false } = {}) {
    const before = recordHistory ? snapshot() : null;
    app.warnCanvas?.(proj.canvas, '뼈대 작업');
    const loadedPieces = [];
    for (const p of proj.pieces) {
      const img = await readDataUrl(p.png);
      loadedPieces.push({ ...p, image: img });
    }
    const replacement = keepAnimations
      ? replaceRigProjectKeepingAnimations(
        { animations },
        { ...proj, pieces: loadedPieces },
        bonesView?.getSelectedBone?.(),
      )
      : null;
    const loaded = replacement?.project || { ...proj, pieces: loadedPieces };

    // 상태 일괄 교체
    canvasWidth = loaded.canvas[0];
    canvasHeight = loaded.canvas[1];
    currentSlot = loaded.slot;
    currentItem = loaded.item;
    bones = loaded.bones;
    animations = loaded.animations;
    restPose = loaded.restPose || null;
    const rawLayers = loaded.presetLayers || role?.presetLayers;
    const layerState = normalizeRigLayerState(rawLayers, loaded.pieces);
    const migrated = migrateLegacyLayersToDepth(layerState.layers, layerState.pieces);
    pieces = migrated.pieces;
    presetLayers = migrated.layers;
    selectedPresetLayerKey = null;
    skeletonName = String(role?.skeletonName || CURRENT_PROFILE.skeletonName);
    const draft = role?.presetDraft || role?.presetDrafts?.[0];
    presetMeta = draft
      ? { id: draft.id || 'preset', name: draft.name || '새 프리셋', kind: draft.kind || 'bare' }
      : { id: 'preset', name: currentItem || '새 프리셋', kind: currentSlot || 'bare' };

    bonesView?.refresh();
    presetView?.refresh();
    if (recordHistory) recordChange(before);
    else {
      history.clear();
      updateUndoRedo();
    }
    lastReplacement = replacement;
    return replacement;
  }

  async function loadMotionProjectData(proj, role = null, { keepAnimations = true, recordHistory = false } = {}) {
    const before = recordHistory ? motionSnapshot() : null;
    app.warnCanvas?.(proj.canvas, '키잡기 뼈대');
    const loadedPieces = [];
    for (const piece of proj.pieces) {
      loadedPieces.push({ ...piece, image: await readDataUrl(piece.png) });
    }
    const layerState = normalizeRigLayerState(proj.presetLayers || role?.presetLayers, loadedPieces);
    const migrated = migrateLegacyLayersToDepth(layerState.layers, layerState.pieces);
    const incoming = { ...proj, pieces: migrated.pieces, presetLayers: migrated.layers };
    const replacement = keepAnimations
      ? replaceRigProjectKeepingAnimations(
        { animations: motionRig.animations },
        incoming,
        motionView?.getSelectedBone?.(),
      )
      : null;
    const loaded = replacement?.project || incoming;
    const draft = role?.presetDraft || role?.presetDrafts?.[0];
    motionRig = cloneRigState({
      canvas: loaded.canvas,
      baseTitle: loaded.item,
      skeletonName: String(role?.skeletonName || CURRENT_PROFILE.skeletonName),
      presetMeta: draft
        ? { id: draft.id || 'preset', name: draft.name || loaded.item, kind: draft.kind || loaded.slot }
        : { id: 'preset', name: loaded.item, kind: loaded.slot },
      presetLayers: loaded.presetLayers,
      pieces: loaded.pieces,
      bones: loaded.bones,
      animations: loaded.animations,
      restPose: loaded.restPose,
      visibilityMode: role?.visibilityMode === 'group' ? 'group' : 'individual',
    });
    motionView?.selectBone?.(replacement?.selectedBone || motionRig.bones[0]?.name);
    motionView?.refresh();
    if (recordHistory) recordMotionChange(before);
    else {
      motionHistory.clear();
      updateUndoRedo();
    }
    return replacement;
  }

  function currentPreset() {
    return presetView.currentPreset();
  }

  function projectSnapshot() {
    return toProject({
      canvas: [canvasWidth, canvasHeight],
      slot: currentSlot,
      item: currentItem,
      basePng: null,
      pieces,
      bones,
      animations,
      restPose,
      presetLayers,
    });
  }

  function bindEvents() {
    // 되돌리기 / 다시하기 단추
    undoBtn?.addEventListener('click', undo);
    redoBtn?.addEventListener('click', redo);

    // 프로젝트 저장
    $('#rig-save-project')?.addEventListener('click', async () => {
      const fileName = `rig-${currentItem}.json`;
      const result = await saveJson(fileName, rigProjectWithoutAnimations(projectSnapshot()));
      if (result !== 'cancelled') app.toast(`「${fileName}」으로 저장했습니다`);
    });

    // 전체 열기 — rig-1 JSON, 고도 장면, 웹에서 만든 무압축 ZIP을 한 자리에서 받습니다.
    $('#rig-open-project')?.addEventListener('click', async () => {
      try {
        const [file] = await pickFiles({ accept: '.json,.tscn,.zip,application/json,application/zip,text/plain' });
        if (!file) return;
        const name = file.name.toLowerCase();
        let proj, warnings = null;
        if (name.endsWith('.zip')) {
          const loaded = projectFromGodotZip(new Uint8Array(await file.arrayBuffer()));
          loaded.project.restPose = null;
          proj = loaded.project;
          warnings = loaded.warnings;
          await loadProjectData(proj);
        } else if (name.endsWith('.tscn')) {
          const loaded = projectFromGodotTscn(await file.text());
          proj = loaded.project;
          warnings = loaded.warnings;
          await loadProjectData(proj);
        } else if (name.endsWith('.json')) {
          proj = parseProject(JSON.parse(await file.text()));
          let replacement;
          if (proj.basePng) {
            openLegacyOptions = { keepAnimations: false, recordHistory: true };
            try {
              await app.loadLegacyRig(proj);
            } finally {
              openLegacyOptions = null;
            }
            replacement = lastReplacement;
          } else {
            replacement = await loadProjectData(proj, null, { keepAnimations: false, recordHistory: true });
          }
          if (importReport) {
            importReport.textContent = '';
            importReport.hidden = true;
          }
          app.toast('뼈대 전체 작업을 열었습니다');
          app.changed();
          return;
        } else {
          throw new Error('JSON, TSCN 또는 무압축 ZIP 파일을 골라 주세요');
        }

        if (warnings) {
          if (importReport) {
            importReport.textContent = warnings.length
              ? `「${file.name}」에서 확인할 내용 ${warnings.length}개\n${warnings.map(item => `• ${item}`).join('\n')}`
              : `「${file.name}」의 뼈와 움직임을 모두 읽었습니다.`;
            importReport.hidden = false;
          }
          app.toast(warnings.length ? `뼈와 움직임을 읽고, 확인할 내용 ${warnings.length}개를 보고했습니다` : '고도 장면의 뼈와 움직임을 불러왔습니다');
        } else {
          if (importReport) {
            importReport.textContent = '';
            importReport.hidden = true;
          }
          app.toast('뼈 애니메이션 작업 파일을 불러왔습니다');
        }
        app.changed();
      } catch (err) {
        app.toast(err.message || '작업 파일을 열 수 없습니다');
      }
    });

    // 뼈대 하위 서브탭 전환 (이전 호환용)
    const tabBonePieces = $('#rig-tab-bone-pieces');
    const tabBoneProps = $('#rig-tab-bone-props');
    const tabPresetLayers = $('#rig-tab-preset-layers');
    const panelBonePieces = $('#rig-panel-bone-pieces');
    const panelBoneProps = $('#rig-panel-bone-props');
    const panelPresetLayers = $('#rig-panel-preset-layers');

    function switchSubTab(mode) {
      if (tabBonePieces) tabBonePieces.setAttribute('aria-selected', String(mode === 'pieces'));
      if (tabBoneProps) tabBoneProps.setAttribute('aria-selected', String(mode === 'props'));
      if (tabPresetLayers) tabPresetLayers.setAttribute('aria-selected', String(mode === 'layers'));
      if (panelBonePieces) panelBonePieces.hidden = mode !== 'pieces';
      if (panelBoneProps) panelBoneProps.hidden = mode !== 'props';
      if (panelPresetLayers) panelPresetLayers.hidden = mode !== 'layers';
    }

    tabBonePieces?.addEventListener('click', () => switchSubTab('pieces'));
    tabBoneProps?.addEventListener('click', () => switchSubTab('props'));
    tabPresetLayers?.addEventListener('click', () => switchSubTab('layers'));
  }

  function setStep(step) {
    currentStep = step;
    $('#rig').classList.toggle('rig-mode-bones', step === 'rig');
    $('#rig').classList.toggle('rig-mode-motion', step === 'motion');
    if (step === 'rig') {
      presetView.syncVisibilityModeToActiveTab();
      bonesView.show();
    }
    else bonesView.hide();
    if (step === 'motion') {
      motionView.show();
    }
    else motionView.hide();
    updateUndoRedo();
  }

  function initUI() {
    bindEvents();
    presetView.refresh();
    updateUndoRedo();
  }

  initUI();

  return {
    shown() {
      bonesView.shown();
      motionView.shown();
    },
    setStep,
    getBasis: () => ({
      canvas: [canvasWidth, canvasHeight],
      skeletonName,
      bones,
      restPose,
    }),
    getMotionBasis: () => motionRig.bones.length ? ({
      canvas: [...motionRig.canvas],
      skeletonName: motionRig.skeletonName,
      bones: motionRig.bones,
      restPose: motionRig.restPose,
    }) : null,
    getPieces: () => pieces,
    getPreset: () => currentPreset(),
    snapshot() {
      return projectSnapshot();
    },
    roleSnapshot() {
      const role = workingRigToRoleState({
        canvas: [canvasWidth, canvasHeight], item: currentItem, slot: currentSlot, skeletonName,
        bones, restPose, attachedPieces: pieces, animations: {}, preset: currentPreset(), presetLayers,
      });
      role.visibilityMode = visibilityMode;
      return role;
    },
    motionRoleSnapshot() {
      return workingMotionToRoleState(motionRig);
    },
    async restoreRole(saved, options = openLegacyOptions || {}) {
      return await loadProjectData(roleRigToWorkingState(saved), saved, options);
    },
    async restore(saved) {
      if (!saved) return;
      try {
        const proj = parseProject(saved);
        await loadProjectData(proj);
      } catch (err) {
        // 복원 실패 시 조용히 무시
      }
    },
    async restoreMotionRole(saved) {
      if (!saved) {
        motionRig = emptyMotionRigState();
        motionHistory.clear();
        motionView?.refresh();
        updateUndoRedo();
        return;
      }
      const state = roleMotionToWorkingState(saved);
      const proj = toProject({
        canvas: state.canvas,
        slot: state.presetMeta.kind,
        item: state.baseTitle,
        basePng: null,
        pieces: state.pieces,
        bones: state.bones,
        animations: state.animations,
        restPose: state.restPose,
        presetLayers: state.presetLayers,
      });
      await loadMotionProjectData(proj, saved, { keepAnimations: false, recordHistory: false });
    },
  };
}
