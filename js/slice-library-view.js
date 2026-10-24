// 자르기 조각 보관함 화면 — 이름 붙은 PNG의 저장·다시 고르기·내려받기를 다룹니다.
import { clearMask } from './core/slice.js';
import { dropKey, KEY, toHex } from './core/paint.js';
import { toSliceLibraryItem, makeSliceLibraryZip } from './core/slice-library.js';
import { drawPixels, pickFiles, readImageFile, toPngDataUrl, savePng, saveFile, baseName } from './io.js';

const $ = sel => document.querySelector(sel);

export function mountSliceLibrary(app, model) {
  const list = $('#rig-pieces-list');
  let pieces = model.getPieces();
  let baseImage = model.getBaseImage();
  let [canvasWidth, canvasHeight] = model.getSize();
  let mask = model.getMask();

  function sync() {
    pieces = model.getPieces();
    baseImage = model.getBaseImage();
    [canvasWidth, canvasHeight] = model.getSize();
    mask = model.getMask();
  }

  function reselectPiece(piece) {
    clearMask(mask);
    const data = piece.image.data;
    for (let index = 0; index < mask.length; index++) mask[index] = data[index * 4 + 3] > 0 ? 1 : 0;
    model.drawOverlay();
    app.toast(`조각 「${piece.name}」의 영역을 다시 골랐습니다`);
  }

  function render() {
    list.innerHTML = '';
    if (pieces.length === 0) {
      list.innerHTML = '<p class="hint" style="grid-column:1/-1;text-align:center;">보관한 조각이 없습니다</p>';
      return;
    }
    pieces.forEach((piece, index) => {
      const card = document.createElement('div');
      card.className = 'rig-piece-card';
      card.title = '누르면 이 조각의 영역을 다시 고릅니다';

      const thumb = document.createElement('canvas');
      thumb.className = 'rig-piece-thumb';
      drawPixels(thumb, piece.image, 1, toHex(KEY));

      const title = document.createElement('div');
      title.className = 'rig-piece-title';
      title.textContent = piece.name;

      const actions = document.createElement('div');
      actions.className = 'rig-piece-actions';
      const action = (text, run) => {
        const button = document.createElement('button');
        button.className = 'btn';
        button.textContent = text;
        button.addEventListener('click', run);
        actions.appendChild(button);
      };
      action('PNG', async () => {
        await savePng(`${piece.id}.png`, piece.image);
        app.toast(`「${piece.id}.png」을 내려받았습니다`);
      });
      action('삭제', () => {
        const before = model.snapshot();
        pieces.splice(index, 1);
        render();
        model.commit(before);
        app.toast(`조각 「${piece.name}」을 지웠습니다`);
      });

      card.addEventListener('click', event => {
        if (!event.target.closest('button')) reselectPiece(piece);
      });
      card.append(thumb, title, actions);
      list.appendChild(card);
    });
  }

  function savePiece(image, name, sourceKind = 'manual', pieceName = '') {
    const sameName = pieces.find(piece => piece.name === name && piece.sourceKind === sourceKind);
    let normalized = toSliceLibraryItem({
      id: name,
      name,
      png: toPngDataUrl(image),
      width: image.width,
      height: image.height,
      sourceKind,
      piece: pieceName || name,
    });
    if (sameName) {
      normalized = { ...normalized, id: sameName.id, piece: sameName.piece };
    } else {
      const base = normalized.id;
      let suffix = 2;
      while (pieces.some(piece => piece.id === normalized.id)) normalized = { ...normalized, id: `${base}_${suffix++}` };
    }
    const value = { ...normalized, image };
    const existing = pieces.findIndex(piece => piece.id === value.id);
    if (existing >= 0) pieces[existing] = value;
    else pieces.push(value);
    render();
    return existing >= 0;
  }

  $('#rig-add-piece-png')?.addEventListener('click', async () => {
    try {
      const [file] = await pickFiles({ accept: 'image/png,image/*' });
      if (!file) return;
      const before = model.snapshot();
      const image = dropKey(await readImageFile(file));
      if (baseImage && (image.width !== canvasWidth || image.height !== canvasHeight)) {
        return app.toast(`조각 크기(${image.width}×${image.height})가 현재 판 크기(${canvasWidth}×${canvasHeight})와 다릅니다`);
      }
      if (!baseImage) model.setEmptyCanvas(image.width, image.height);
      sync();
      const name = baseName(file.name);
      savePiece(image, name);
      model.commit(before);
      app.toast(`조각 「${name}」을 보관했습니다`);
    } catch (error) {
      app.toast(error.message || '조각 PNG를 열 수 없습니다');
    }
  });

  $('#slice-save-all')?.addEventListener('click', async () => {
    try {
      const made = makeSliceLibraryZip(pieces);
      await saveFile('자르기-조각.zip', new Blob([made.bytes], { type: 'application/zip' }));
      app.toast(`조각 ${made.entries.length}개를 ZIP으로 내려받았습니다`);
    } catch (error) {
      app.toast(error.message || '조각 ZIP을 만들 수 없습니다');
    }
  });

  return { render, sync, reselectPiece, savePiece };
}
