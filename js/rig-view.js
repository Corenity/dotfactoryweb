// 뼈 탭 화면 — 조각 자르기, 뼈대 연결, 작업 파일 저장을 다룹니다.
import { SLOTS, SLOT_NAMES, PIECE_NAMES, piecesOf, createMask, clearMask, fillMask, setMaskRect, fillPolygonMask, paintBrushMask, hasSelection, extractPiece } from './core/slice.js';
import { toProject, parseProject, defaultZIndex, defaultBoneFor, cloneDefaultBones, defaultAnimations, normalizeAnimations } from './core/rig.js';
import { dropKey } from './core/paint.js';
import { drawPixels, pickFiles, readImageFile, readDataUrl, toPngDataUrl, savePng, saveJson, baseName } from './io.js';
import { backdropToggle } from './backdrop.js';
import { mountRigBones } from './rig-bones-view.js';
import { mountMotion } from './motion-view.js';
import { mountRigExport } from './rig-export-view.js';
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
  let animations = defaultAnimations();
  let currentSlot = 'bare';
  let currentItem = '맨몸';
  let currentPiece = 'torso';
  let tool = 'box'; // 'box' | 'lasso' | 'brush' | 'eraser'
  let brushSize = 1;
  let cell = 4;
  let panX = 0, panY = 0;

  // 두 손가락 이동 및 포인터 제어 (paint-view 와 동일)
  const pointers = new Map();
  let pan = null;
  let maskBeforeStroke = null;
  let dragStart = null;
  let dragCurrent = null;
  let lassoPoints = [];

  const stage = $('#rig-stage');
  const baseCanvas = $('#rig-canvas');
  const overlayCanvas = $('#rig-overlay');
  const emptyHint = $('#rig-empty');
  const slotSelect = $('#rig-slot-select');
  const itemInput = $('#rig-item-name');
  const pieceSelect = $('#rig-piece-select');
  const piecesList = $('#rig-pieces-list');
  const zoomText = $('#rig-zoom-text');

  let bonesView = null, motionView = null, exportView = null;
  // 투명화 단추 — 자르기와 뼈 미리보기가 같은 초록 ↔ 체크무늬 상태를 씁니다.
  const bg = backdropToggle($('#rig-clear'), () => { render(); bonesView?.refresh(); motionView?.refresh(); });
  bonesView = mountRigBones(app, {
    getBones: () => bones,
    setBones: value => { bones = value; },
    getPieces: () => pieces,
    getSize: () => [canvasWidth, canvasHeight],
    getBackdrop: () => bg.backdrop,
    changed: () => {},
    renameBone: (from, to) => {
      for (const motion of Object.values(animations)) {
        if (!(from in motion.tracks)) continue;
        motion.tracks[to] = motion.tracks[from];
        delete motion.tracks[from];
      }
    },
  });
  motionView = mountMotion(app, {
    getBones: () => bones,
    getPieces: () => pieces,
    getAnimations: () => animations,
    setAnimations: value => { animations = normalizeAnimations(value, bones); },
    getSize: () => [canvasWidth, canvasHeight],
    getBackdrop: () => bg.backdrop,
    forSave: image => bg.forSave(image),
  });
  exportView = mountRigExport(app, { getProject: () => projectSnapshot() });

  function initUI() {
    initSlotSelect();
    updatePieceSelect();
    bindEvents();
    render();
  }

  function initSlotSelect() {
    slotSelect.innerHTML = '';
    for (const slot of Object.keys(SLOTS)) {
      const opt = document.createElement('option');
      opt.value = slot;
      opt.textContent = `${SLOT_NAMES[slot] || slot} (${slot})`;
      slotSelect.appendChild(opt);
    }
    slotSelect.value = currentSlot;
  }

  function updatePieceSelect() {
    pieceSelect.innerHTML = '';
    const list = piecesOf(currentSlot);
    for (const piece of list) {
      const opt = document.createElement('option');
      opt.value = piece;
      opt.textContent = `${PIECE_NAMES[piece] || piece} (${piece})`;
      pieceSelect.appendChild(opt);
    }
    if (list.includes(currentPiece)) {
      pieceSelect.value = currentPiece;
    } else if (list.length > 0) {
      currentPiece = list[0];
      pieceSelect.value = currentPiece;
    }
  }

  function setBaseImage(img, name = '캐릭터') {
    baseImage = img;
    baseTitle = baseName(name);
    canvasWidth = img.width;
    canvasHeight = img.height;
    mask = createMask(canvasWidth, canvasHeight);
    emptyHint.hidden = true;
    baseCanvas.hidden = false;
    overlayCanvas.hidden = false;
    fit();
    bonesView?.refresh();
  }

  function clearBaseImage() {
    baseImage = null;
    baseTitle = '캐릭터';
    mask = createMask(canvasWidth, canvasHeight);
    emptyHint.hidden = false;
    baseCanvas.hidden = true;
    overlayCanvas.hidden = true;
    render();
    bonesView?.refresh();
  }

  // 다듬기와 같은 규칙: 스테이지 크기에 맞춰 정수 배율 계산 후 중앙 translate
  function fit() {
    if (!baseImage) return;
    const w = stage.clientWidth || 320;
    const h = stage.clientHeight || 240;
    cell = Math.max(1, Math.floor(Math.min(w / canvasWidth, h / canvasHeight)));
    panX = Math.round((w - canvasWidth * cell) / 2);
    panY = Math.round((h - canvasHeight * cell) / 2);
    render();
  }

  function zoomStep(direction) {
    if (!baseImage) return;
    const next = Math.max(1, Math.min(16, cell + direction));
    if (next === cell) return;
    const w = stage.clientWidth || 320;
    const h = stage.clientHeight || 240;
    const cx = w / 2, cy = h / 2;
    const ux = (cx - panX) / cell, uy = (cy - panY) / cell;
    cell = next;
    panX = Math.round(cx - ux * cell);
    panY = Math.round(cy - uy * cell);
    render();
  }

  function render() {
    emptyHint.hidden = !!baseImage;
    baseCanvas.hidden = !baseImage;
    overlayCanvas.hidden = !baseImage;
    zoomText.textContent = `${cell}배`;

    if (!baseImage) return;

    // 1. 원본 그림판 렌더링 (정수 배율로 확대하여 그리고 위치 translate)
    drawPixels(baseCanvas, baseImage, cell, bg.backdrop);
    baseCanvas.style.transform = `translate(${panX}px, ${panY}px)`;

    // 2. 오버레이 캔버스 크기 및 위치 맞춤
    overlayCanvas.width = canvasWidth * cell;
    overlayCanvas.height = canvasHeight * cell;
    overlayCanvas.style.transform = `translate(${panX}px, ${panY}px)`;

    drawOverlay();
  }

  function drawOverlay() {
    if (!baseImage) return;
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // 마스크 영역 표시 (반투명 파랑)
    ctx.fillStyle = 'rgba(40, 160, 255, 0.45)';
    for (let y = 0; y < canvasHeight; y++) {
      for (let x = 0; x < canvasWidth; x++) {
        if (mask[y * canvasWidth + x]) {
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    }

    // 드래그 중인 가이드 라인 그리기
    if (dragStart) {
      ctx.lineWidth = Math.max(1, Math.floor(cell / 4));
      if (tool === 'box') {
        const [x0, y0] = dragStart;
        const [x1, y1] = dragCurrent || dragStart;
        const left = Math.min(x0, x1), top = Math.min(y0, y1);
        const w = Math.abs(x1 - x0) + 1, h = Math.abs(y1 - y0) + 1;
        ctx.strokeStyle = '#32d74b';
        ctx.strokeRect(left * cell + 0.5, top * cell + 0.5, w * cell - 1, h * cell - 1);
      } else if (tool === 'lasso' && lassoPoints.length > 1) {
        ctx.strokeStyle = '#ffd60a';
        ctx.beginPath();
        ctx.moveTo(lassoPoints[0][0] * cell + cell / 2, lassoPoints[0][1] * cell + cell / 2);
        for (let i = 1; i < lassoPoints.length; i++) {
          ctx.lineTo(lassoPoints[i][0] * cell + cell / 2, lassoPoints[i][1] * cell + cell / 2);
        }
        ctx.stroke();
      }
    }
  }

  function cellAt(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    return [
      Math.max(0, Math.min(canvasWidth - 1, Math.floor((clientX - r.left - panX) / cell))),
      Math.max(0, Math.min(canvasHeight - 1, Math.floor((clientY - r.top - panY) / cell))),
    ];
  }

  function strokeStart(at) {
    dragStart = at;
    dragCurrent = at;
    maskBeforeStroke = new Uint8Array(mask);
    if (tool === 'lasso') {
      lassoPoints = [at];
    } else if (tool === 'brush') {
      paintBrushMask(mask, canvasWidth, canvasHeight, at[0], at[1], brushSize, 1);
    } else if (tool === 'eraser') {
      paintBrushMask(mask, canvasWidth, canvasHeight, at[0], at[1], brushSize, 0);
    }
    drawOverlay();
  }

  function strokeMove(at) {
    dragCurrent = at;
    if (tool === 'lasso') {
      const last = lassoPoints[lassoPoints.length - 1];
      if (!last || last[0] !== at[0] || last[1] !== at[1]) {
        lassoPoints.push(at);
      }
    } else if (tool === 'brush') {
      paintBrushMask(mask, canvasWidth, canvasHeight, at[0], at[1], brushSize, 1);
    } else if (tool === 'eraser') {
      paintBrushMask(mask, canvasWidth, canvasHeight, at[0], at[1], brushSize, 0);
    }
    drawOverlay();
  }

  function strokeEnd() {
    if (tool === 'box' && dragStart && dragCurrent) {
      setMaskRect(mask, canvasWidth, canvasHeight, dragStart, dragCurrent, 1);
    } else if (tool === 'lasso' && lassoPoints.length >= 3) {
      fillPolygonMask(mask, canvasWidth, canvasHeight, lassoPoints, 1);
    }
    dragStart = null;
    dragCurrent = null;
    lassoPoints = [];
    maskBeforeStroke = null;
    drawOverlay();
  }

  function strokeCancel() {
    if (maskBeforeStroke) {
      mask.set(maskBeforeStroke);
      maskBeforeStroke = null;
    }
    dragStart = null;
    dragCurrent = null;
    lassoPoints = [];
    drawOverlay();
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
    slotSelect.value = currentSlot;
    itemInput.value = currentItem;
    updatePieceSelect();
    pieces = loadedPieces;

    if (loadedBase) {
      setBaseImage(loadedBase, currentItem);
    } else if (pieces.length > 0) {
      // basePng 없이 조각만 있으면 빈 투명 판을 만들어 작업할 수 있게 함
      setBaseImage({ width: canvasWidth, height: canvasHeight, data: new Uint8ClampedArray(canvasWidth * canvasHeight * 4) }, currentItem);
    } else {
      // basePng도 없고 조각도 없으면 원본도 깨끗이 비움
      clearBaseImage();
    }
    renderPiecesList();
  }

  function projectSnapshot() {
    return toProject({
      canvas: [canvasWidth, canvasHeight],
      slot: currentSlot,
      item: currentItem,
      basePng: baseImage ? toPngDataUrl(baseImage) : null,
      pieces,
      bones,
      animations,
    });
  }

  function bindEvents() {
    // 탭 단계 단추
    $('#rig-step-slice').addEventListener('click', () => setStep('slice'));
    $('#rig-step-rig').addEventListener('click', () => setStep('rig'));
    $('#rig-step-motion').addEventListener('click', () => setStep('motion'));
    $('#rig-step-export').addEventListener('click', () => setStep('export'));

    // 도구 선택
    const tools = ['box', 'lasso', 'brush', 'eraser'];
    for (const t of tools) {
      $(`#rig-tool-${t}`).addEventListener('click', () => {
        tool = t;
        for (const o of tools) $(`#rig-tool-${o}`).setAttribute('aria-pressed', String(o === t));
      });
    }

    // 붓 크기
    $('#rig-brush-size').addEventListener('change', e => {
      brushSize = Number(e.target.value) || 1;
    });

    // 전체 선택 / 해제
    $('#rig-select-all').addEventListener('click', () => {
      if (!baseImage) return;
      fillMask(mask);
      drawOverlay();
    });
    $('#rig-clear-selection').addEventListener('click', () => {
      if (!baseImage) return;
      clearMask(mask);
      drawOverlay();
    });

    // 줌 조작
    $('#rig-zoom-in').addEventListener('click', () => zoomStep(1));
    $('#rig-zoom-out').addEventListener('click', () => zoomStep(-1));
    $('#rig-zoom-fit').addEventListener('click', fit);

    // 슬롯 및 조각 변경
    slotSelect.addEventListener('change', e => {
      currentSlot = e.target.value;
      updatePieceSelect();
    });
    itemInput.addEventListener('input', e => {
      currentItem = e.target.value.trim() || '맨몸';
    });
    pieceSelect.addEventListener('change', e => {
      currentPiece = e.target.value;
    });

    // 원본 그림 올리기 (기존 조각이 있고 크기가 다르면 거절)
    $('#rig-open-base').addEventListener('click', async () => {
      try {
        const [file] = await pickFiles({ accept: 'image/*' });
        if (!file) return;
        const img = await readImageFile(file);
        const dropped = dropKey(img);

        if (pieces.length > 0 && (dropped.width !== canvasWidth || dropped.height !== canvasHeight)) {
          app.toast(`새 그림 크기(${dropped.width}×${dropped.height})가 기존 조각 판 크기(${canvasWidth}×${canvasHeight})와 다릅니다. 기존 조각을 먼저 비우거나 같은 크기 그림을 올려 주세요`);
          return;
        }

        setBaseImage(dropped, file.name);
        app.toast(`「${file.name}」을 불러왔습니다`);
        app.changed();
      } catch (err) {
        if (err.message) app.toast(err.message);
      }
    });

    // 선택 영역을 조각으로 저장
    $('#rig-save-piece').addEventListener('click', () => {
      if (!baseImage) {
        app.toast('먼저 원본 그림을 올려 주세요');
        return;
      }
      if (!hasSelection(mask)) {
        app.toast('선택된 칸이 없습니다. 네모나 올가미로 영역을 골라 주세요');
        return;
      }
      const pieceImg = extractPiece(baseImage, mask);
      const pngUrl = toPngDataUrl(pieceImg);
      const pieceName = `${currentSlot}_${currentPiece}`;

      const existing = pieces.findIndex(p => p.slot === currentSlot && p.piece === currentPiece);
      const pieceObj = {
        slot: currentSlot,
        item: currentItem,
        piece: currentPiece,
        name: pieceName,
        bone: defaultBoneFor(currentSlot, currentPiece),
        zIndex: defaultZIndex(currentSlot, currentPiece),
        visible: true,
        png: pngUrl,
        image: pieceImg,
      };

      if (existing >= 0) {
        pieces[existing] = pieceObj;
        app.toast(`조각 「${pieceName}」을 갱신했습니다`);
      } else {
        pieces.push(pieceObj);
        app.toast(`조각 「${pieceName}」을 등록했습니다`);
      }
      renderPiecesList();
      app.changed();
    });

    // 조각 PNG 파일 올리기 (판 크기와 다르면 거절)
    $('#rig-add-piece-png').addEventListener('click', async () => {
      try {
        const [file] = await pickFiles({ accept: 'image/*' });
        if (!file) return;
        const img = await readImageFile(file);
        const dropped = dropKey(img);

        if (baseImage && (dropped.width !== canvasWidth || dropped.height !== canvasHeight)) {
          app.toast(`조각 크기(${dropped.width}×${dropped.height})가 현재 판 크기(${canvasWidth}×${canvasHeight})와 다릅니다`);
          return;
        }

        if (!baseImage) {
          canvasWidth = dropped.width;
          canvasHeight = dropped.height;
          setBaseImage({ width: canvasWidth, height: canvasHeight, data: new Uint8ClampedArray(canvasWidth * canvasHeight * 4) }, '캐릭터');
        }

        const pngUrl = toPngDataUrl(dropped);
        const pieceName = `${currentSlot}_${currentPiece}`;
        const existing = pieces.findIndex(p => p.slot === currentSlot && p.piece === currentPiece);
        const pieceObj = {
          slot: currentSlot,
          item: currentItem,
          piece: currentPiece,
          name: pieceName,
          bone: defaultBoneFor(currentSlot, currentPiece),
          zIndex: defaultZIndex(currentSlot, currentPiece),
          visible: true,
          png: pngUrl,
          image: dropped,
        };
        if (existing >= 0) pieces[existing] = pieceObj;
        else pieces.push(pieceObj);
        renderPiecesList();
        app.toast(`조각 「${pieceName}」을 파일에서 가져왔습니다`);
        app.changed();
      } catch (err) {
        if (err.message) app.toast(err.message);
      }
    });

    // 프로젝트 저장
    $('#rig-save-project').addEventListener('click', () => {
      const proj = projectSnapshot();
      saveJson(`rig-${currentItem}.json`, proj);
      app.toast(`「rig-${currentItem}.json」으로 저장했습니다`);
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
          proj = loaded.project; warnings = loaded.warnings;
        } else if (name.endsWith('.tscn')) {
          const loaded = projectFromGodotTscn(await file.text());
          proj = loaded.project; warnings = loaded.warnings;
        } else if (name.endsWith('.json')) {
          proj = parseProject(JSON.parse(await file.text()));
        } else {
          throw new Error('JSON, TSCN 또는 무압축 ZIP 파일을 골라 주세요');
        }
        await loadProjectData(proj);
        if (warnings) {
          exportView.report(file.name, warnings);
          setStep('export');
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

    // pointer 이벤트 — 한 손가락: 도구, 두 손가락: 이동 (paint-view 와 동일)
    stage.addEventListener('pointerdown', e => {
      if (!baseImage) return;
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (e.pointerType === 'mouse' && e.button !== 0) {
        pan = { x: e.clientX, y: e.clientY, panX, panY };
        return;
      }

      if (pointers.size === 1) {
        const at = cellAt(e.clientX, e.clientY);
        strokeStart(at);
      } else if (pointers.size === 2) {
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
        const x = list.reduce((s, p) => s + p.x, 0) / list.length;
        const y = list.reduce((s, p) => s + p.y, 0) / list.length;
        if (list.length >= 2 || e.pointerType === 'mouse') {
          panX = pan.panX + Math.round(x - pan.x);
          panY = pan.panY + Math.round(y - pan.y);
          render();
        }
        return;
      }

      if (pointers.size === 1 && dragStart) {
        const at = cellAt(e.clientX, e.clientY);
        strokeMove(at);
      }
    });

    const onPointerUp = e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);

      if (pan) {
        if (!pointers.size) pan = null;
        return;
      }

      if (e.type === 'pointercancel') {
        strokeCancel();
        return;
      }

      strokeEnd();
    };

    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
  }

  function setStep(step) {
    const steps = ['slice', 'rig', 'motion', 'export'];
    for (const s of steps) {
      $(`#rig-step-${s}`).setAttribute('aria-selected', String(s === step));
    }
    $('#rig').classList.toggle('rig-mode-bones', step === 'rig');
    $('#rig').classList.toggle('rig-mode-motion', step === 'motion');
    $('#rig').classList.toggle('rig-mode-export', step === 'export');
    if (step === 'rig') bonesView.show();
    else bonesView.hide();
    if (step === 'motion') motionView.show();
    else motionView.hide();
    if (step === 'export') exportView.show();
    else exportView.hide();
  }

  // 다시 고르기: 조각의 칸/부위/조각을 폼에 맞추고 조각의 불투명 칸을 마스크로 불러옵니다.
  function reselectPiece(p) {
    currentSlot = p.slot;
    currentItem = p.item;
    currentPiece = p.piece;
    slotSelect.value = currentSlot;
    itemInput.value = currentItem;
    updatePieceSelect();

    clearMask(mask);
    const pData = p.image.data;
    for (let i = 0; i < mask.length; i++) {
      if (pData[i * 4 + 3] > 0) {
        mask[i] = 1;
      }
    }
    drawOverlay();
    app.toast(`조각 「${p.name}」의 영역을 다시 골랐습니다`);
  }

  function renderPiecesList() {
    piecesList.innerHTML = '';
    if (pieces.length === 0) {
      piecesList.innerHTML = '<p class="hint" style="grid-column:1/-1;text-align:center;">등록된 조각이 없습니다</p>';
      bonesView.refresh();
      return;
    }

    pieces.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = 'rig-piece-card';
      card.title = '누르면 이 조각의 영역을 다시 고릅니다';

      const thumb = document.createElement('canvas');
      thumb.className = 'rig-piece-thumb';
      drawPixels(thumb, p.image, 1, 'checker');

      const title = document.createElement('div');
      title.className = 'rig-piece-title';
      title.textContent = `${SLOT_NAMES[p.slot] || p.slot} · ${PIECE_NAMES[p.piece] || p.piece}`;

      card.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        reselectPiece(p);
      });

      const actions = document.createElement('div');
      actions.className = 'rig-piece-actions';

      const reselectBtn = document.createElement('button');
      reselectBtn.className = 'btn';
      reselectBtn.textContent = '다시고르기';
      reselectBtn.addEventListener('click', () => reselectPiece(p));

      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn';
      dlBtn.textContent = '내려받기';
      dlBtn.addEventListener('click', () => {
        downloadPiecePng(p);
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'btn';
      delBtn.textContent = '삭제';
      delBtn.addEventListener('click', () => {
        pieces.splice(idx, 1);
        renderPiecesList();
        app.toast(`조각 「${p.name}」을 지웠습니다`);
        app.changed();
      });

      actions.appendChild(reselectBtn);
      actions.appendChild(dlBtn);
      actions.appendChild(delBtn);

      card.appendChild(thumb);
      card.appendChild(title);
      card.appendChild(actions);
      piecesList.appendChild(card);
    });
    bonesView.refresh();
  }

  async function downloadPiecePng(p) {
    try {
      await savePng(`${p.item}_${p.piece}.png`, p.image);
      app.toast(`「${p.item}_${p.piece}.png」 내려받기를 완료했습니다`);
    } catch (err) {
      app.toast('다운로드에 실패했습니다');
    }
  }

  initUI();

  return {
    shown() {
      fit();
      render();
      bonesView.shown();
      motionView.shown();
    },
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
