// 뼈 조각 목록 화면 — 조각 등록, PNG 올리기, 조각 목록 표시, 다시 고르기와 내려받기를 다룹니다.
import { SLOTS, SLOT_NAMES, PIECE_NAMES, piecesOf, clearMask, hasSelection, extractPiece, isValidPieceName } from './core/slice.js';
import { defaultZIndex, defaultBoneFor } from './core/rig.js';
import { dropKey } from './core/paint.js';
import { drawPixels, pickFiles, readImageFile, toPngDataUrl, savePng } from './io.js';

const $ = sel => document.querySelector(sel);

export function mountRigPieces(app, model) {
  const slotSelect = $('#rig-slot-select');
  const itemInput = $('#rig-item-name');
  const pieceSelect = $('#rig-piece-select');
  const pieceSelectWrap = $('#rig-piece-select-wrap');
  const pieceCustomWrap = $('#rig-piece-custom-wrap');
  const pieceCustomInput = $('#rig-piece-custom');
  const piecesList = $('#rig-pieces-list');

  let currentSlot = 'bare';
  let currentItem = '맨몸';
  let currentPiece = 'torso';

  let pieces = model.getPieces();
  let baseImage = model.getBaseImage();
  let [canvasWidth, canvasHeight] = model.getSize();
  let mask = model.getMask();
  let itemBefore = null;

  function sync(slot, item) {
    if (slot !== undefined) currentSlot = slot;
    if (item !== undefined) currentItem = item;
    pieces = model.getPieces();
    baseImage = model.getBaseImage();
    const [w, h] = model.getSize();
    canvasWidth = w;
    canvasHeight = h;
    mask = model.getMask();
    slotSelect.value = currentSlot;
    itemInput.value = currentItem;
    updatePieceSelect();
  }

  function snapshot() { return model.snapshot(); }
  function recordChange(before) { model.commit(before); }
  function drawOverlay() { model.drawOverlay(); }
  function setBaseImage(img, name) {
    model.setBaseImage(img, name);
    baseImage = model.getBaseImage();
    const [w, h] = model.getSize();
    canvasWidth = w;
    canvasHeight = h;
    mask = model.getMask();
  }
  const bonesView = { refresh: () => model.refreshBones() };

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
    if (currentSlot === 'extra') {
      if (pieceSelectWrap) pieceSelectWrap.hidden = true;
      if (pieceCustomWrap) pieceCustomWrap.hidden = false;
      currentPiece = pieceCustomInput ? pieceCustomInput.value.trim() : currentPiece;
    } else {
      if (pieceSelectWrap) pieceSelectWrap.hidden = false;
      if (pieceCustomWrap) pieceCustomWrap.hidden = true;
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
  }

  // 다시 고르기: 조각의 칸/부위/조각을 폼에 맞추고 조각의 불투명 칸을 마스크로 불러옵니다.
  function reselectPiece(p) {
    currentSlot = p.slot;
    currentItem = p.item;
    currentPiece = p.piece;
    slotSelect.value = currentSlot;
    itemInput.value = currentItem;
    if (currentSlot === 'extra' && pieceCustomInput) {
      pieceCustomInput.value = currentPiece;
    }
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
        const before = snapshot();
        pieces.splice(idx, 1);
        renderPiecesList();
        recordChange(before);
        app.toast(`조각 「${p.name}」을 지웠습니다`);
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

  function bindEvents() {
    // 슬롯 및 조각 변경
    slotSelect.addEventListener('change', e => {
      currentSlot = e.target.value;
      updatePieceSelect();
    });
    itemInput.addEventListener('focus', () => {
      itemBefore = snapshot();
    });
    itemInput.addEventListener('input', e => {
      currentItem = e.target.value.trim() || '맨몸';
    });
    itemInput.addEventListener('change', () => {
      if (itemBefore) {
        recordChange(itemBefore);
        itemBefore = null;
      }
    });
    pieceSelect.addEventListener('change', e => {
      currentPiece = e.target.value;
    });
    if (pieceCustomInput) {
      pieceCustomInput.addEventListener('input', e => {
        currentPiece = e.target.value.trim();
      });
    }

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
      if (currentSlot === 'extra') {
        if (!currentPiece) {
          app.toast('기타 조각 이름을 넣어 주세요');
          return;
        }
        if (!isValidPieceName(currentPiece)) {
          app.toast('기타 조각 이름은 영문 소문자, 숫자, _ 만 쓸 수 있습니다');
          return;
        }
      }
      const before = snapshot();
      const pieceImg = extractPiece(baseImage, mask);
      const pngUrl = toPngDataUrl(pieceImg);
      const pieceName = `${currentSlot}_${currentPiece}`;

      const existing = pieces.findIndex(p => p.slot === currentSlot && p.piece === currentPiece);
      const pieceObj = {
        slot: currentSlot,
        item: currentItem,
        piece: currentPiece,
        name: pieceName,
        bone: defaultBoneFor(currentSlot, currentPiece, model.getBones?.(), model.getSelectedBone?.()),
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
      recordChange(before);
    });

    // 조각 PNG 파일 올리기 (판 크기와 다르면 거절)
    $('#rig-add-piece-png').addEventListener('click', async () => {
      try {
        const [file] = await pickFiles({ accept: 'image/*' });
        if (!file) return;
        if (currentSlot === 'extra') {
          if (!currentPiece) {
            app.toast('기타 조각 이름을 넣어 주세요');
            return;
          }
          if (!isValidPieceName(currentPiece)) {
            app.toast('기타 조각 이름은 영문 소문자, 숫자, _ 만 쓸 수 있습니다');
            return;
          }
        }
        const before = snapshot();
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
          bone: defaultBoneFor(currentSlot, currentPiece, model.getBones?.(), model.getSelectedBone?.()),
          zIndex: defaultZIndex(currentSlot, currentPiece),
          visible: true,
          png: pngUrl,
          image: dropped,
        };

        if (existing >= 0) pieces[existing] = pieceObj;
        else pieces.push(pieceObj);
        renderPiecesList();
        recordChange(before);
        app.toast(`조각 「${pieceName}」을 파일에서 가져왔습니다`);
      } catch (err) {
        if (err.message) app.toast(err.message);
      }
    });
  }

  initSlotSelect();
  updatePieceSelect();
  bindEvents();

  return {
    render: renderPiecesList,
    reselectPiece,
    updatePieceSelect,
    sync,
    getSlot: () => currentSlot,
    getItem: () => currentItem,
    getPiece: () => currentPiece,
  };
}
