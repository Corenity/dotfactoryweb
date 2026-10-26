// 뼈대·키잡기 화면 — 뼈, 붙인 그림, 움직임과 옛 작업 파일 호환을 다룹니다.
import { toProject, parseProject, cloneDefaultBones, defaultAnimations, normalizeAnimations } from './core/rig.js';
import { KEY, toHex } from './core/paint.js';
import { pickFiles, readDataUrl, saveJson } from './io.js';
import { RigHistory, cloneRigState } from './core/rig-history.js';
import { workingRigToRoleState, roleRigToWorkingState } from './core/role-flow.js';
import { mountRigBones } from './rig-bones-view.js';
import { mountRigPreset } from './rig-preset-view.js';
import { mountMotion } from './motion-view.js';
import { projectFromGodotTscn, projectFromGodotZip } from './core/godot-export.js';
import { normalizeRigLayerState, migrateLegacyLayersToDepth } from './core/preset-layers.js';
import { CURRENT_PROFILE } from './core/profile.js';

const $ = sel => document.querySelector(sel);

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

  const undoBtn = $('#rig-undo');
  const redoBtn = $('#rig-redo');
  const importReport = $('#rig-import-report');

  const history = new RigHistory();

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

  function updateUndoRedo() {
    if (undoBtn) undoBtn.disabled = !history.canUndo;
    if (redoBtn) redoBtn.disabled = !history.canRedo;
  }

  function recordChange(before) {
    if (!before) return;
    if (history.push(before, snapshot())) {
      updateUndoRedo();
      app.changed();
    }
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
    motionView?.refresh();
    updateUndoRedo();
    app.changed();
  }

  function undo() {
    const prev = history.undo(snapshot());
    if (prev) applySnapshot(prev);
  }

  function redo() {
    const next = history.redo(snapshot());
    if (next) applySnapshot(next);
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
      motionView?.refresh();
    },
  });
  motionView = mountMotion(app, {
    getBones: () => bones,
    getPieces: () => pieces,
    getPresetLayers: () => presetLayers,
    getVisibilityMode: () => visibilityMode,
    setVisibilityMode: value => { visibilityMode = value === 'group' ? 'group' : 'individual'; },
    getAnimations: () => animations,
    setAnimations: value => { animations = normalizeAnimations(value, bones); },
    getSize: () => [canvasWidth, canvasHeight],
    getBackdrop: () => toHex(KEY),
    getItem: () => currentItem,
    snapshot: () => snapshot(),
    commit: before => recordChange(before),
  });

  // 작업 열기와 자동 복원의 단일 통합 함수
  async function loadProjectData(proj, role = null) {
    app.warnCanvas?.(proj.canvas, '뼈대 작업');
    const loadedPieces = [];
    for (const p of proj.pieces) {
      const img = await readDataUrl(p.png);
      loadedPieces.push({ ...p, image: img });
    }

    // 상태 일괄 교체
    canvasWidth = proj.canvas[0];
    canvasHeight = proj.canvas[1];
    currentSlot = proj.slot;
    currentItem = proj.item;
    bones = proj.bones;
    animations = proj.animations;
    restPose = proj.restPose || null;
    const rawLayers = proj.presetLayers || role?.presetLayers;
    const layerState = normalizeRigLayerState(rawLayers, loadedPieces);
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
    motionView?.refresh();
    history.clear();
    updateUndoRedo();
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
    $('#rig-save-project')?.addEventListener('click', () => {
      const proj = projectSnapshot();
      saveJson(`rig-${currentItem}.json`, proj);
      app.toast(`「rig-${currentItem}.json」으로 저장했습니다`);
    });

    // 프로젝트 열기 — rig-1 JSON, 고도 장면, 웹에서 만든 무압축 ZIP을 한 자리에서 받습니다.
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
        } else if (name.endsWith('.tscn')) {
          const loaded = projectFromGodotTscn(await file.text());
          proj = loaded.project;
          warnings = loaded.warnings;
        } else if (name.endsWith('.json')) {
          proj = parseProject(JSON.parse(await file.text()));
          await app.loadLegacyRig(proj);
          if (importReport) {
            importReport.textContent = '';
            importReport.hidden = true;
          }
          app.toast('옛 작업 파일을 자르기와 뼈대 작업으로 나누어 불러왔습니다');
          return;
        } else {
          throw new Error('JSON, TSCN 또는 무압축 ZIP 파일을 골라 주세요');
        }
        await loadProjectData(proj);
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

    // 파일 팝업 창 토글
    const fileBtn = $('#rig-file-btn');
    const filePop = $('#rig-file-pop');
    const filePopClose = $('#rig-file-pop-close');

    function toggleFilePop(show) {
      if (!filePop) return;
      const willShow = show != null ? show : filePop.hidden;
      filePop.hidden = !willShow;
      if (fileBtn) fileBtn.setAttribute('aria-expanded', String(willShow));
    }

    fileBtn?.addEventListener('click', e => {
      e.stopPropagation();
      toggleFilePop();
    });
    filePopClose?.addEventListener('click', () => toggleFilePop(false));
    filePop?.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', e => {
      if (!filePop || filePop.hidden) return;
      if (!filePop.contains(e.target) && e.target !== fileBtn) {
        toggleFilePop(false);
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
    $('#rig').classList.toggle('rig-mode-bones', step === 'rig');
    $('#rig').classList.toggle('rig-mode-motion', step === 'motion');
    if (step === 'rig') {
      presetView.syncVisibilityModeToActiveTab();
      bonesView.show();
    }
    else bonesView.hide();
    if (step === 'motion') motionView.show();
    else motionView.hide();
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
    getPieces: () => pieces,
    getPreset: () => currentPreset(),
    snapshot() {
      return projectSnapshot();
    },
    roleSnapshot() {
      const role = workingRigToRoleState({
        canvas: [canvasWidth, canvasHeight], item: currentItem, slot: currentSlot, skeletonName,
        bones, restPose, attachedPieces: pieces, animations, preset: currentPreset(), presetLayers,
      });
      role.visibilityMode = visibilityMode;
      return role;
    },
    async restoreRole(saved) {
      await loadProjectData(roleRigToWorkingState(saved), saved);
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
  };
}
