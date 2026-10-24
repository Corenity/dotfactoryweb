// site/js/rig-auto-slice-view.js — 자르기 화면의 전체 자동 조각 분할 화면 제어 모듈입니다.
import { DEFAULT_BARE_LAYERS_META } from './core/preset-stack.js';
import { makeBackgroundTransparent } from './core/background.js';
import { readImageFile, toPngDataUrl } from './io.js';
import {
  PIECE_COLOR_MAP,
  PIECE_HEX_MAP,
  KIND_PIECES_META,
  buildBareInfo,
  autoSlice,
  extractPiecesFromAssignments,
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
  const kind = 'all';
  let assignments = null;
  let selectedPieceLabel = 1;
  let brushSize = 1;
  let bareInfo = null;
  let bareOpacity = 0.5;
  let userModifiedMask = null;

  // 부위 팔레트 UI 렌더링 (헤어 · 표정 · 몸 · 왼팔 · 오른팔 · 왼다리 · 오른다리 · 왼신발 · 오른신발 · 버림)
  function renderPalette() {
    const wrap = $('#rig-auto-palette');
    if (!wrap) return;
    wrap.innerHTML = '';

    const metas = KIND_PIECES_META.all;
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

    // 버리기 단추
    const dropBtn = document.createElement('button');
    dropBtn.className = 'btn rig-palette-btn rig-palette-drop';
    dropBtn.type = 'button';
    dropBtn.setAttribute('aria-pressed', String(selectedPieceLabel === 0));
    dropBtn.innerHTML = `<span class="rig-palette-dot rig-drop-dot">✕</span>버림`;
    dropBtn.addEventListener('click', () => {
      selectedPieceLabel = 0;
      renderPalette();
    });
    wrap.appendChild(dropBtn);
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
      kind: 'all',
      bareInfo,
      stripBare: true,
      preservedAssignments: assignments,
      userModifiedMask,
    });
    assignments = res.assignments;
  }

  // 붓으로 픽셀 칠하기
  function paintCell(cx, cy, label = selectedPieceLabel) {
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

    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const s = (y * w + x) * 4;
        if (baseImage.data[s + 3] > 0) {
          const idx = y * w + x;
          assignments[idx] = label;
          userModifiedMask[idx] = 1;
        }
      }
    }
  }

  // 오버레이 캔버스 그리기 (반투명 맨몸 + 원본 그림 + 부위 색상)
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

    // 2. 올린 그림 그리기
    for (let y = 0; y < canvasHeight; y++) {
      for (let x = 0; x < canvasWidth; x++) {
        const s = (y * canvasWidth + x) * 4;
        const a = baseImage.data[s + 3];
        if (a > 0) {
          ctx.fillStyle = `rgba(${baseImage.data[s]}, ${baseImage.data[s + 1]}, ${baseImage.data[s + 2]}, ${a / 255})`;
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    }

    // 3. 나눈 결과를 부위별 색으로 겹쳐 보이기
    if (assignments) {
      const metas = KIND_PIECES_META.all;
      const colorByLabel = {};
      for (const m of metas) {
        colorByLabel[m.label] = PIECE_COLOR_MAP[m.piece] || 'rgba(50, 215, 75, 0.55)';
      }

      for (let y = 0; y < canvasHeight; y++) {
        for (let x = 0; x < canvasWidth; x++) {
          const idx = y * canvasWidth + x;
          const label = assignments[idx];
          if (label > 0 && colorByLabel[label]) {
            ctx.fillStyle = colorByLabel[label];
            ctx.fillRect(x * cell, y * cell, cell, cell);
          }
        }
      }
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
      kind: 'all',
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
    // 붓 크기
    $('#rig-auto-brush-size')?.addEventListener('change', e => {
      brushSize = Number(e.target.value) || 1;
    });

    // 일괄 조각 저장 단추
    $('#rig-auto-save-pieces')?.addEventListener('click', savePieces);

    // 맨몸 진하기 밀대 (0~100%, 10% 단위, 처음 50%)
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

  return {
    async init() {
      if (!bareInfo) bareInfo = await loadBareInfo();
      userModifiedMask = null;
      await computeAutoSlice();
      renderPalette();
      model.drawOverlay();
    },
    drawOverlay,
    paintCell(cx, cy) {
      paintCell(cx, cy, selectedPieceLabel);
    },
    getKind: () => kind,
    getAssignments: () => assignments,
    savePieces,
    getBareOpacity: () => bareOpacity,
  };
}
