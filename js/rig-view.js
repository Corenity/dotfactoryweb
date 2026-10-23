// 뼈 탭 화면 — 조각 자르기, 뼈대 연결, 작업 파일 저장을 다룹니다.
import { createMask } from './core/slice.js';
import { toProject, parseProject, cloneDefaultBones, defaultAnimations, normalizeAnimations } from './core/rig.js';
import { KEY, toHex, dropKey } from './core/paint.js';
import { pickFiles, readImageFile, readDataUrl, toPngDataUrl, saveJson, baseName } from './io.js';
import { RigHistory, cloneRigState } from './core/rig-history.js';
import { mountRigSlice } from './rig-slice-view.js';
import { mountRigPieces } from './rig-pieces-view.js';
import { mountRigBones } from './rig-bones-view.js';
import { mountMotion } from './motion-view.js';
import { mountRigExport } from './rig-export-view.js';
import { mountCharacterPlay } from './character-play-view.js';
import { projectFromGodotTscn, projectFromGodotZip } from './core/godot-export.js';

const $ = sel => document.querySelector(sel);

export function mountRig(app) {
  let baseImage = null;
  let baseTitle = '캐릭터';
  let canvasWidth = 72;
  let canvasHeight = 64;
  let mask = createMask(canvasWidth, canvasHeight);
  let pieces = [];
  let bones = cloneDefaultBones();
  let restPose = null;
  let animations = defaultAnimations();
  let currentSlot = 'bare';
  let currentItem = '맨몸';

  const undoBtn = $('#rig-undo');
  const redoBtn = $('#rig-redo');

  const history = new RigHistory();

  function snapshot() {
    return cloneRigState({
      canvas: [canvasWidth, canvasHeight],
      baseTitle,
      baseImage,
      pieces,
      bones,
      animations,
      restPose,
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
    baseTitle = copy.baseTitle;
    baseImage = copy.baseImage;
    pieces = copy.pieces;
    bones = copy.bones;
    animations = copy.animations;
    restPose = copy.restPose || null;
    mask = createMask(canvasWidth, canvasHeight);
    sliceView.sync();
    piecesView.sync();
    piecesView.render();
    sliceView.render();
    bonesView?.refresh();
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

  let sliceView = null, piecesView = null, bonesView = null, motionView = null, exportView = null, playView = null;
  sliceView = mountRigSlice(app, {
    getBaseImage: () => baseImage,
    getSize: () => [canvasWidth, canvasHeight],
    getMask: () => mask,
  });
  piecesView = mountRigPieces(app, {
    getPieces: () => pieces,
    getBaseImage: () => baseImage,
    getMask: () => mask,
    getSize: () => [canvasWidth, canvasHeight],
    setBaseImage: (img, name) => setBaseImage(img, name),
    drawOverlay: () => sliceView.drawOverlay(),
    refreshBones: () => bonesView?.refresh(),
    getBones: () => bones,
    getSelectedBone: () => bonesView?.getSelectedBone?.(),
    getItem: () => (piecesView ? piecesView.getItem() : currentItem),
    snapshot: () => snapshot(),
    commit: before => recordChange(before),
  });
  bonesView = mountRigBones(app, {
    getBones: () => bones,
    setBones: value => { bones = value; },
    getRestPose: () => restPose,
    setRestPose: value => { restPose = value; },
    getAnimations: () => animations,
    setAnimations: value => { animations = value; },
    getPieces: () => pieces,
    getSize: () => [canvasWidth, canvasHeight],
    getBackdrop: () => toHex(KEY),
    changed: () => {},
    renameBone: (from, to) => {
      for (const motion of Object.values(animations)) {
        if (!(from in motion.tracks)) continue;
        motion.tracks[to] = motion.tracks[from];
        delete motion.tracks[from];
      }
    },
    getItem: () => (piecesView ? piecesView.getItem() : currentItem),
    snapshot: () => snapshot(),
    commit: before => recordChange(before),
  });
  motionView = mountMotion(app, {
    getBones: () => bones,
    getPieces: () => pieces,
    getAnimations: () => animations,
    setAnimations: value => { animations = normalizeAnimations(value, bones); },
    getSize: () => [canvasWidth, canvasHeight],
    getBackdrop: () => toHex(KEY),
    getItem: () => (piecesView ? piecesView.getItem() : currentItem),
    snapshot: () => snapshot(),
    commit: before => recordChange(before),
  });
  exportView = mountRigExport(app, { getProject: () => projectSnapshot() });
  playView = mountCharacterPlay(app, {
    getProject: () => projectSnapshot(),
    getPresetStack: () => app.getPresetStack?.(),
  });

  function setBaseImage(img, name = '캐릭터') {
    baseImage = img;
    baseTitle = baseName(name);
    canvasWidth = img.width;
    canvasHeight = img.height;
    mask = createMask(canvasWidth, canvasHeight);
    sliceView.sync();
    piecesView.sync();
    sliceView.fit();
    bonesView?.refresh();
  }

  function clearBaseImage() {
    baseImage = null;
    baseTitle = '캐릭터';
    mask = createMask(canvasWidth, canvasHeight);
    sliceView.sync();
    piecesView.sync();
    sliceView.render();
    bonesView?.refresh();
  }

  // 작업 열기와 자동 복원의 단일 통합 함수
  async function loadProjectData(proj) {
    const loadedPieces = [];
    for (const p of proj.pieces) {
      const img = await readDataUrl(p.png);
      loadedPieces.push({ ...p, image: img });
    }

    let loadedBase = null;
    if (proj.basePng) {
      loadedBase = await readDataUrl(proj.basePng);
    }

    // 상태 일괄 교체
    canvasWidth = proj.canvas[0];
    canvasHeight = proj.canvas[1];
    currentSlot = proj.slot;
    currentItem = proj.item;
    bones = proj.bones;
    animations = proj.animations;
    restPose = proj.restPose || null;
    pieces = loadedPieces;

    piecesView.sync(currentSlot, currentItem);

    if (loadedBase) {
      setBaseImage(loadedBase, currentItem);
    } else if (pieces.length > 0) {
      // basePng 없이 조각만 있으면 빈 투명 판을 만들어 작업할 수 있게 함
      setBaseImage({ width: canvasWidth, height: canvasHeight, data: new Uint8ClampedArray(canvasWidth * canvasHeight * 4) }, currentItem);
    } else {
      // basePng도 없고 조각도 없으면 원본도 깨끗이 비움
      clearBaseImage();
    }
    piecesView.render();
    history.clear();
    updateUndoRedo();
  }

  function projectSnapshot() {
    return toProject({
      canvas: [canvasWidth, canvasHeight],
      slot: piecesView ? piecesView.getSlot() : currentSlot,
      item: piecesView ? piecesView.getItem() : currentItem,
      basePng: baseImage ? toPngDataUrl(baseImage) : null,
      pieces,
      bones,
      animations,
      restPose,
    });
  }

  function bindEvents() {
    // 되돌리기 / 다시하기 단추
    undoBtn?.addEventListener('click', undo);
    redoBtn?.addEventListener('click', redo);

    // 원본 그림 올리기 (기존 조각이 있고 크기가 다르면 거절)
    $('#rig-open-base').addEventListener('click', async () => {
      try {
        const [file] = await pickFiles({ accept: 'image/*' });
        if (!file) return;
        const before = snapshot();
        const img = await readImageFile(file);
        const dropped = dropKey(img);

        if (pieces.length > 0 && (dropped.width !== canvasWidth || dropped.height !== canvasHeight)) {
          app.toast(`새 그림 크기(${dropped.width}×${dropped.height})가 기존 조각 판 크기(${canvasWidth}×${canvasHeight})와 다릅니다. 기존 조각을 먼저 비우거나 같은 크기 그림을 올려 주세요`);
          return;
        }

        setBaseImage(dropped, file.name);
        recordChange(before);
        app.toast(`「${file.name}」을 불러왔습니다`);
      } catch (err) {
        if (err.message) app.toast(err.message);
      }
    });

    // 프로젝트 저장
    $('#rig-save-project').addEventListener('click', () => {
      const item = piecesView ? piecesView.getItem() : currentItem;
      const proj = projectSnapshot();
      saveJson(`rig-${item}.json`, proj);
      app.toast(`「rig-${item}.json」으로 저장했습니다`);
    });

    // 프로젝트 열기 — rig-1 JSON, 고도 장면, 웹에서 만든 무압축 ZIP을 한 자리에서 받습니다.
    $('#rig-open-project').addEventListener('click', async () => {
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
        } else {
          throw new Error('JSON, TSCN 또는 무압축 ZIP 파일을 골라 주세요');
        }
        await loadProjectData(proj);
        if (warnings) {
          exportView.report(file.name, warnings);
          app.show('export');
          app.toast(warnings.length ? `뼈와 움직임을 읽고, 확인할 내용 ${warnings.length}개를 보고했습니다` : '고도 장면의 뼈와 움직임을 불러왔습니다');
        } else {
          exportView.clearReport();
          app.toast('뼈 애니메이션 작업 파일을 불러왔습니다');
        }
        app.changed();
      } catch (err) {
        app.toast(err.message || '작업 파일을 열 수 없습니다');
      }
    });
  }

  function setStep(step) {
    if (step === 'slice') {
      sliceView.render();
      sliceView.fit();
    }
    $('#rig').classList.toggle('rig-mode-bones', step === 'rig');
    $('#rig').classList.toggle('rig-mode-motion', step === 'motion');
    $('#rig').classList.toggle('rig-mode-export', step === 'export');
    if (step === 'rig') bonesView.show();
    else bonesView.hide();
    if (step === 'motion') motionView.show();
    else motionView.hide();
    if (step === 'export') {
      exportView.show();
      playView.show();
    } else {
      exportView.hide();
      playView.hide();
    }
  }

  function initUI() {
    bindEvents();
    sliceView.render();
    piecesView.render();
    updateUndoRedo();
  }

  initUI();

  return {
    shown() {
      sliceView.fit();
      sliceView.render();
      bonesView.shown();
      motionView.shown();
    },
    setStep,
    getPieces: () => pieces,
    snapshot() {
      return projectSnapshot();
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
