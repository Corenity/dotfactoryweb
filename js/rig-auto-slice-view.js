// site/js/rig-auto-slice-view.js — 자르기 화면의 종류별 자르기(전체·헤어·표정·옷·신발) 화면 제어 모듈입니다.
import { DEFAULT_BARE_LAYERS_META } from './core/preset-stack.js';
import { makeBackgroundTransparent } from './core/background.js';
import { readImageFile, toPngDataUrl } from './io.js';
import { isValidPieceName } from './core/slice.js';
import {
  SLICE_KINDS,
  PIECE_COLOR_MAP,
  PIECE_HEX_MAP,
  KIND_PIECES_META,
  buildBareInfo,
  autoSlice,
  pickDecoration,
  extractPiecesFromAssignments,
  extractSkinColors,
} from './core/auto-slice.js';

const $ = sel => document.querySelector(sel);

let bareInfoPromise = null;
async function loadBareInfo() {
  if (bareInfoPromise) return bareInfoPromise;
  bareInfoPromise = (async () => {
    const layers = [];
    for (const meta of DEFAULT_BARE_LAYERS_META) {
      try {
        const res = await fetch(meta.file);
        if (!res.ok) continue;
        const blob = await res.blob();
        const img = await readImageFile(blob);
        const { image: cleanImg } = makeBackgroundTransparent(img);
        layers.push({
          id: meta.id,
          zIndex: meta.zIndex,
          piece: meta.piece,
          image: cleanImg,
        });
      } catch (e) {
        // 네트워크 실패 등은 건너뜀
      }
    }
    return buildBareInfo(layers, 72, 64);
  })();
  return bareInfoPromise;
}

export function mountRigAutoSlice(app, model) {
  let kind = 'outfit';
  try {
    const qKind = new URLSearchParams(window.location.search).get('autoKind');
    if (qKind && SLICE_KINDS.includes(qKind)) kind = qKind;
  } catch (e) {}
  let stripBare = true;
  let offset = [0, 0];
  let assignments = null;
  let selectedPieceLabel = 1;
  let brushSize = 1;
  let bareInfo = null;
  let bareOpacity = 0.5;

  // 전체(all) 모드 전용 상태
  let faceEllipse = { cx: 36.5, cy: 30, rx: 10.5, ry: 8 };
  let toolMode = 'brush'; // 'brush' | 'pick' | 'skin'
  let decorations = []; // [{ name, mask }]
  let userModifiedMask = null; // 붓으로 고친 칸 마스크 (타원 조절 시 유지)
  let skinColors = []; // [[r,g,b], ...]

  function updateModeSpecificUI() {
    const isAll = (kind === 'all');
    for (const o of SLICE_KINDS) {
      $(`#rig-auto-kind-${o}`)?.setAttribute('aria-pressed', String(o === kind));
    }
    const ellipseRow = $('#rig-auto-ellipse-row');
    if (ellipseRow) ellipseRow.hidden = !isAll;
    const decoRow = $('#rig-auto-deco-row');
    if (decoRow) decoRow.hidden = !isAll;
    const skinRow = $('#rig-auto-skin-row');
    if (skinRow) skinRow.hidden = !isAll;
  }

  // 부위 팔레트 UI 갱신
  function renderPalette() {
    const wrap = $('#rig-auto-palette');
    if (!wrap) return;
    wrap.innerHTML = '';

    const metas = KIND_PIECES_META[kind] || KIND_PIECES_META.outfit;
    // 부위 라벨이 유효한지 검사
    if (!metas.some(m => m.label === selectedPieceLabel) && selectedPieceLabel !== 0) {
      selectedPieceLabel = metas[0]?.label || 1;
    }

    for (const m of metas) {
      const btn = document.createElement('button');
      btn.className = 'btn rig-palette-btn';
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(selectedPieceLabel === m.label));
      const hex = PIECE_HEX_MAP[m.piece] || '#32d74b';
      btn.innerHTML = `<span class="rig-palette-dot" style="background:${hex};"></span>${m.name}`;
      btn.addEventListener('click', () => {
        selectedPieceLabel = m.label;
        renderPalette();
      });
      wrap.appendChild(btn);
    }

    // 버리기(지우개) 단추
    const dropBtn = document.createElement('button');
    dropBtn.className = 'btn rig-palette-btn rig-palette-drop';
    dropBtn.type = 'button';
    dropBtn.setAttribute('aria-pressed', String(selectedPieceLabel === 0));
    dropBtn.innerHTML = `<span class="rig-palette-dot rig-drop-dot">✕</span>버리기`;
    dropBtn.addEventListener('click', () => {
      selectedPieceLabel = 0;
      renderPalette();
    });
    wrap.appendChild(dropBtn);
  }

  // 살색 목록 chip 렌더링
  function renderSkinChips() {
    const wrap = $('#rig-auto-skin-chips');
    if (!wrap) return;
    wrap.innerHTML = '';
    skinColors.forEach((c, idx) => {
      const btn = document.createElement('button');
      btn.className = 'rig-skin-chip';
      btn.type = 'button';
      btn.title = `rgb(${c[0]},${c[1]},${c[2]}) 버리기에서 제외하려면 클릭`;
      btn.innerHTML = `<span class="rig-skin-chip-color" style="background: rgb(${c[0]},${c[1]},${c[2]});"></span>rgb(${c[0]},${c[1]},${c[2]}) <span class="rig-skin-chip-remove">✕</span>`;
      btn.addEventListener('click', async () => {
        skinColors.splice(idx, 1);
        renderSkinChips();
        await computeAutoSlice();
        model.drawOverlay();
      });
      wrap.appendChild(btn);
    });
  }

  // 자동 분할 재계산
  async function computeAutoSlice() {
    const baseImage = model.getBaseImage();
    if (!baseImage) {
      assignments = null;
      return;
    }
    if (!bareInfo) {
      bareInfo = await loadBareInfo();
    }
    const [w, h] = model.getSize();
    if (!userModifiedMask || userModifiedMask.length !== w * h) {
      userModifiedMask = new Uint8Array(w * h);
    }

    const res = autoSlice({
      image: baseImage,
      kind,
      bareInfo,
      stripBare,
      offset,
      faceEllipse,
      preservedAssignments: assignments,
      userModifiedMask,
      skinColors,
      skinTolerance: 14,
    });
    assignments = res.assignments;
  }

  // 이동 오프셋 표시 갱신
  function updateOffsetText() {
    const txt = $('#rig-auto-offset-text');
    if (txt) {
      txt.textContent = `${offset[0]}, ${offset[1]}`;
    }
  }

  // 붓으로 픽셀 칠하기
  function paintCell(cx, cy, label) {
    const baseImage = model.getBaseImage();
    if (!baseImage || !assignments) return;
    const [w, h] = model.getSize();
    const radius = Math.floor(brushSize / 2);
    const left = Math.max(0, cx - radius);
    const right = Math.min(w - 1, cx + (brushSize - 1 - radius));
    const top = Math.max(0, cy - radius);
    const bottom = Math.min(h - 1, cy + (brushSize - 1 - radius));

    if (!userModifiedMask || userModifiedMask.length !== w * h) {
      userModifiedMask = new Uint8Array(w * h);
    }

    const [ox, oy] = offset;
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const srcX = x - ox;
        const srcY = y - oy;
        if (srcX >= 0 && srcX < w && srcY >= 0 && srcY < h) {
          const s = (srcY * w + srcX) * 4;
          if (baseImage.data[s + 3] > 0) {
            const idx = y * w + x;
            assignments[idx] = label;
            userModifiedMask[idx] = 1; // 사용자가 고친 칸 기록
          }
        }
      }
    }
  }

  // 「눌러서 떼기」(장식) 클릭 처리
  function handlePickDeco(cx, cy) {
    const baseImage = model.getBaseImage();
    if (!baseImage) return;

    const rawName = ($('#rig-auto-deco-name')?.value || 'sword').trim().toLowerCase();
    const decoName = isValidPieceName(rawName) ? rawName : 'extra_part';

    const res = pickDecoration({
      image: baseImage,
      startX: cx,
      startY: cy,
      offset,
      darkOutlineThreshold: 85,
      colorTolerance: 24,
    });

    if (res.all.length === 0) {
      app.toast('선택할 수 있는 칸이 없습니다');
      return;
    }

    const [w, h] = model.getSize();
    let existing = decorations.find(d => d.name === decoName);
    if (!existing) {
      existing = {
        name: decoName,
        mask: new Uint8Array(w * h),
      };
      decorations.push(existing);
    }

    for (const [px, py] of res.all) {
      if (px >= 0 && px < w && py >= 0 && py < h) {
        existing.mask[py * w + px] = 1;
      }
    }

    app.toast(`장식 「${decoName}」에 ${res.all.length}칸을 추가했습니다`);
    model.drawOverlay();
  }

  // 「살색 고르기」 클릭 처리
  function handlePickSkin(cx, cy) {
    const baseImage = model.getBaseImage();
    if (!baseImage) return;
    const [w, h] = model.getSize();
    const [ox, oy] = offset;
    const srcX = cx - ox;
    const srcY = cy - oy;
    if (srcX < 0 || srcX >= w || srcY < 0 || srcY >= h) return;
    const s = (srcY * w + srcX) * 4;
    if (baseImage.data[s + 3] === 0) return;
    const r = baseImage.data[s];
    const g = baseImage.data[s + 1];
    const b = baseImage.data[s + 2];

    const exists = skinColors.some(sc => {
      const dr = sc[0] - r;
      const dg = sc[1] - g;
      const db = sc[2] - b;
      return Math.sqrt(dr * dr + dg * dg + db * db) < 6;
    });
    if (exists) {
      app.toast('이미 등록된 살색입니다');
      return;
    }

    skinColors.push([r, g, b]);
    renderSkinChips();
    computeAutoSlice().then(() => {
      model.drawOverlay();
      app.toast(`살색 rgb(${r},${g},${b})을(를) 추가했습니다`);
    });
  }

  // 살색 후보 자동 추출
  async function autoExtractSkinCandidates() {
    const baseImage = model.getBaseImage();
    if (!baseImage) return;
    if (!bareInfo) bareInfo = await loadBareInfo();
    const candidates = extractSkinColors(baseImage, bareInfo, faceEllipse);
    if (candidates.length === 0) {
      app.toast('추출할 살색 그늘 후보가 없습니다');
      return;
    }
    skinColors = candidates;
    renderSkinChips();
    await computeAutoSlice();
    model.drawOverlay();
    app.toast(`살색 후보 ${candidates.length}개를 등록했습니다`);
  }

  // 오버레이 캔버스 그리기 (반투명 맨몸 + 원본 그림(offset 이동) + 부위 색상 + 타원 가이드 + 장식)
  function drawOverlay(ctx, cell, canvasWidth, canvasHeight) {
    const baseImage = model.getBaseImage();
    if (!baseImage) return;

    // 1. 맨몸 반투명 겹쳐 보기
    if (bareInfo?.bareImage && bareOpacity > 0) {
      const bareImg = bareInfo.bareImage;
      ctx.save();
      ctx.globalAlpha = bareOpacity;
      for (let y = 0; y < canvasHeight; y++) {
        for (let x = 0; x < canvasWidth; x++) {
          const s = (y * canvasWidth + x) * 4;
          const a = bareImg.data[s + 3];
          if (a > 0) {
            ctx.fillStyle = `rgb(${bareImg.data[s]}, ${bareImg.data[s + 1]}, ${bareImg.data[s + 2]})`;
            ctx.fillRect(x * cell, y * cell, cell, cell);
          }
        }
      }
      ctx.restore();
    }

    // 2. 올린 그림이 offset 이동된 상태로 그려짐
    const [ox, oy] = offset;
    for (let y = 0; y < canvasHeight; y++) {
      for (let x = 0; x < canvasWidth; x++) {
        const srcX = x - ox;
        const srcY = y - oy;
        if (srcX >= 0 && srcX < canvasWidth && srcY >= 0 && srcY < canvasHeight) {
          const s = (srcY * canvasWidth + srcX) * 4;
          const a = baseImage.data[s + 3];
          if (a > 0) {
            ctx.fillStyle = `rgba(${baseImage.data[s]}, ${baseImage.data[s + 1]}, ${baseImage.data[s + 2]}, ${a / 255})`;
            ctx.fillRect(x * cell, y * cell, cell, cell);
          }
        }
      }
    }

    // 3. 나눈 결과를 부위별 색으로 겹쳐 보이기
    if (assignments) {
      const metas = KIND_PIECES_META[kind] || KIND_PIECES_META.outfit;
      const colorByLabel = {};
      for (const m of metas) {
        colorByLabel[m.label] = PIECE_COLOR_MAP[m.piece] || 'rgba(50, 215, 75, 0.55)';
      }

      // 장식 마스크 수집
      const decoCombinedMask = new Uint8Array(canvasWidth * canvasHeight);
      for (const deco of decorations) {
        if (deco.mask) {
          for (let i = 0; i < deco.mask.length; i++) {
            if (deco.mask[i]) decoCombinedMask[i] = 1;
          }
        }
      }

      for (let y = 0; y < canvasHeight; y++) {
        for (let x = 0; x < canvasWidth; x++) {
          const idx = y * canvasWidth + x;
          if (decoCombinedMask[idx]) {
            // 장식은 금색/노랑으로 칠함
            ctx.fillStyle = PIECE_COLOR_MAP.extra || 'rgba(255, 214, 10, 0.65)';
            ctx.fillRect(x * cell, y * cell, cell, cell);
            continue;
          }

          const label = assignments[idx];
          if (label > 0 && colorByLabel[label]) {
            ctx.fillStyle = colorByLabel[label];
            ctx.fillRect(x * cell, y * cell, cell, cell);
          }
        }
      }
    }

    // 4. 전체(all) 모드일 때 얼굴 타원 가이드 선 그리기
    if (kind === 'all') {
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 199, 190, 0.85)';
      ctx.lineWidth = Math.max(1, cell * 0.15);
      ctx.beginPath();
      const centerX = faceEllipse.cx * cell;
      const centerY = faceEllipse.cy * cell;
      const radX = faceEllipse.rx * cell;
      const radY = faceEllipse.ry * cell;
      ctx.ellipse(centerX, centerY, radX, radY, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 조각 보관함에 저장 (일괄 생성·교체, 되돌리기 1단계)
  async function savePieces() {
    const baseImage = model.getBaseImage();
    if (!baseImage) {
      app.toast('먼저 원본 그림을 올려 주세요');
      return;
    }
    if (!assignments) {
      await computeAutoSlice();
    }
    const extracted = extractPiecesFromAssignments({
      image: baseImage,
      assignments,
      kind,
      offset,
      decorations,
    });

    if (extracted.length === 0) {
      app.toast('생성할 조각 픽셀이 없습니다');
      return;
    }

    const before = model.snapshot();
    const pieces = model.getPieces();

    let addedCount = 0;
    let replacedCount = 0;

    for (const item of extracted) {
      const pngUrl = toPngDataUrl(item.image);
      const pieceObj = {
        id: item.name,
        piece: item.piece,
        name: item.name,
        sourceKind: item.sourceKind,
        width: item.image.width,
        height: item.image.height,
        png: pngUrl,
        image: item.image,
      };

      const existing = pieces.findIndex(p => p.id === pieceObj.id);
      if (existing >= 0) {
        pieces[existing] = pieceObj;
        replacedCount++;
      } else {
        pieces.push(pieceObj);
        addedCount++;
      }
    }

    model.renderPiecesList();
    model.commit(before);

    if (replacedCount > 0 && addedCount > 0) {
      app.toast(`조각 ${extracted.length}개를 저장했습니다 (신규 ${addedCount}개, 기존 ${replacedCount}개 교체)`);
    } else if (replacedCount > 0) {
      app.toast(`기존 조각 ${replacedCount}개를 새 내용으로 교체했습니다`);
    } else {
      app.toast(`조각 ${addedCount}개를 보관함에 저장했습니다`);
    }
  }

  function bindEvents() {
    // 1. 종류 선택 세그먼트 (전체 · 헤어 · 표정 · 옷 · 신발)
    for (const k of SLICE_KINDS) {
      const btn = $(`#rig-auto-kind-${k}`);
      if (!btn) continue;
      btn.addEventListener('click', async () => {
        kind = k;
        for (const o of SLICE_KINDS) {
          $(`#rig-auto-kind-${o}`)?.setAttribute('aria-pressed', String(o === k));
        }
        // 초기 stripBare 기본값 조정
        stripBare = (kind === 'outfit' || kind === 'shoes' || kind === 'all');
        const check = $('#rig-auto-strip-bare');
        if (check) check.checked = stripBare;

        if (kind === 'all' && skinColors.length === 0) {
          const baseImage = model.getBaseImage();
          if (baseImage && bareInfo) {
            skinColors = extractSkinColors(baseImage, bareInfo, faceEllipse);
          }
        }

        updateModeSpecificUI();
        renderPalette();
        renderSkinChips();
        await computeAutoSlice();
        model.drawOverlay();
      });
    }

    // 2. 맨몸 색 빼기 체크박스
    const stripCheck = $('#rig-auto-strip-bare');
    if (stripCheck) {
      stripCheck.addEventListener('change', async e => {
        stripBare = !!e.target.checked;
        await computeAutoSlice();
        model.drawOverlay();
      });
    }

    // 3. 자리 맞추기 화살표 조작
    const stepMove = async (dx, dy) => {
      offset = [offset[0] + dx, offset[1] + dy];
      updateOffsetText();
      await computeAutoSlice();
      model.drawOverlay();
    };

    $('#rig-auto-up')?.addEventListener('click', () => stepMove(0, -1));
    $('#rig-auto-down')?.addEventListener('click', () => stepMove(0, 1));
    $('#rig-auto-left')?.addEventListener('click', () => stepMove(-1, 0));
    $('#rig-auto-right')?.addEventListener('click', () => stepMove(1, 0));
    $('#rig-auto-reset')?.addEventListener('click', async () => {
      offset = [0, 0];
      updateOffsetText();
      await computeAutoSlice();
      model.drawOverlay();
    });

    // 4. 얼굴 타원 위치 및 크기 조절
    const adjustEllipse = async (dcx, dcy, drx, dry) => {
      faceEllipse.cx += dcx;
      faceEllipse.cy += dcy;
      faceEllipse.rx = Math.max(1, faceEllipse.rx + drx);
      faceEllipse.ry = Math.max(1, faceEllipse.ry + dry);
      await computeAutoSlice();
      model.drawOverlay();
    };

    $('#rig-auto-ellipse-left')?.addEventListener('click', () => adjustEllipse(-1, 0, 0, 0));
    $('#rig-auto-ellipse-right')?.addEventListener('click', () => adjustEllipse(1, 0, 0, 0));
    $('#rig-auto-ellipse-up')?.addEventListener('click', () => adjustEllipse(0, -1, 0, 0));
    $('#rig-auto-ellipse-down')?.addEventListener('click', () => adjustEllipse(0, 1, 0, 0));
    $('#rig-auto-ellipse-w-dec')?.addEventListener('click', () => adjustEllipse(0, 0, -1, 0));
    $('#rig-auto-ellipse-w-inc')?.addEventListener('click', () => adjustEllipse(0, 0, 1, 0));
    $('#rig-auto-ellipse-h-dec')?.addEventListener('click', () => adjustEllipse(0, 0, 0, -1));
    $('#rig-auto-ellipse-h-inc')?.addEventListener('click', () => adjustEllipse(0, 0, 0, 1));

    // 5. 도구 전환 (붓 vs 눌러서 떼기 vs 살색 고르기)
    const brushToolBtn = $('#rig-auto-tool-brush');
    const pickToolBtn = $('#rig-auto-tool-pick-deco');
    const pickSkinBtn = $('#rig-auto-tool-pick-skin');

    function setToolMode(mode) {
      toolMode = mode;
      brushToolBtn?.setAttribute('aria-pressed', String(mode === 'brush'));
      pickToolBtn?.setAttribute('aria-pressed', String(mode === 'pick'));
      pickSkinBtn?.setAttribute('aria-pressed', String(mode === 'skin'));
    }

    brushToolBtn?.addEventListener('click', () => setToolMode('brush'));
    pickToolBtn?.addEventListener('click', () => setToolMode('pick'));
    pickSkinBtn?.addEventListener('click', () => setToolMode('skin'));

    // 장식 비우기
    $('#rig-auto-deco-clear')?.addEventListener('click', () => {
      decorations = [];
      app.toast('모든 장식을 비웠습니다');
      model.drawOverlay();
    });

    // 살색 자동 추출 및 비우기
    $('#rig-auto-skin-auto')?.addEventListener('click', autoExtractSkinCandidates);
    $('#rig-auto-skin-clear')?.addEventListener('click', async () => {
      skinColors = [];
      renderSkinChips();
      await computeAutoSlice();
      model.drawOverlay();
      app.toast('살색 목록을 비웠습니다');
    });

    // 6. 붓 크기
    $('#rig-auto-brush-size')?.addEventListener('change', e => {
      brushSize = Number(e.target.value) || 1;
    });

    // 7. 일괄 조각 저장 단추
    $('#rig-auto-save-pieces')?.addEventListener('click', savePieces);

    // 8. 맨몸 진하기 밀대 (0~100%, 10% 단위, 처음 50%)
    const opacitySlider = $('#rig-auto-bare-opacity');
    const opacityValue = $('#rig-auto-bare-opacity-value');
    opacitySlider?.addEventListener('input', () => {
      const val = Number(opacitySlider.value);
      bareOpacity = Math.max(0, Math.min(100, Math.round(val / 10) * 10)) / 100;
      if (opacityValue) opacityValue.textContent = `${Math.round(bareOpacity * 100)}%`;
      model.drawOverlay();
    });
  }

  bindEvents();
  renderPalette();
  renderSkinChips();
  updateOffsetText();
  updateModeSpecificUI();

  return {
    async init() {
      if (!bareInfo) bareInfo = await loadBareInfo();
      const baseImage = model.getBaseImage();
      if (kind === 'all' && skinColors.length === 0 && baseImage) {
        skinColors = extractSkinColors(baseImage, bareInfo, faceEllipse);
      }
      await computeAutoSlice();
      renderPalette();
      renderSkinChips();
      updateOffsetText();
      updateModeSpecificUI();
      model.drawOverlay();
    },
    drawOverlay,
    paintCell(cx, cy) {
      if (toolMode === 'skin' && kind === 'all') {
        handlePickSkin(cx, cy);
      } else if (toolMode === 'pick' && kind === 'all') {
        handlePickDeco(cx, cy);
      } else {
        paintCell(cx, cy, selectedPieceLabel);
      }
    },
    getKind: () => kind,
    getOffset: () => offset,
    getAssignments: () => assignments,
    getFaceEllipse: () => faceEllipse,
    getDecorations: () => decorations,
    getSkinColors: () => skinColors,
    savePieces,
    getBareOpacity: () => bareOpacity,
  };
}
