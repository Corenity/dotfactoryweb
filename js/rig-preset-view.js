// 뼈대 단계의 그림 넣기·프리셋 정보·preset-1 열기/저장 화면입니다.
import { PRESET_KINDS, parsePreset } from './core/preset.js';
import { sliceLibraryItemToRigPiece } from './core/slice-library.js';
import {
  attachedPiecesToRigPreset, rigPresetToAttachedPieces, checkRigPresetBones, nextRigZIndex,
} from './core/rig-preset.js';
import { dropKey } from './core/paint.js';
import { pickFiles, readImageFile, readDataUrl, toPngDataUrl, saveJson, baseName } from './io.js';

const $ = selector => document.querySelector(selector);

export function mountRigPreset(app, model) {
  const idInput = $('#rig-preset-id');
  const nameInput = $('#rig-preset-name');
  const kindSelect = $('#rig-preset-kind');
  const assignments = $('#rig-assign-list');
  const warning = $('#rig-preset-warning');
  const picker = $('#rig-piece-picker');
  const library = $('#rig-piece-library');

  const pieces = () => model.getPieces();
  const bones = () => model.getBones();

  function currentPreset() {
    return attachedPiecesToRigPreset({
      ...model.getPresetMeta(), canvas: model.getSize(), pieces: pieces(),
    });
  }

  function finishChange(before) {
    model.refreshViews();
    model.commit(before);
  }

  function renderMeta() {
    const meta = model.getPresetMeta();
    idInput.value = meta.id;
    nameInput.value = meta.name;
    kindSelect.value = meta.kind;
    $('#rig-skeleton-name').textContent = model.getSkeletonName();
  }

  function renderWarning(preset = null) {
    let check;
    try { check = checkRigPresetBones(preset || currentPreset(), bones()); }
    catch (error) {
      warning.textContent = error.message;
      warning.hidden = false;
      return new Set();
    }
    warning.hidden = check.compatible;
    warning.textContent = check.compatible ? '' : `맞지 않음 · 없는 뼈: ${check.missingBones.join(', ')}`;
    return new Set(check.missingBones);
  }

  function renderAssignments() {
    assignments.innerHTML = '';
    const missing = renderWarning();
    if (!pieces().length) {
      assignments.innerHTML = '<p class="hint">「그림 넣기」로 휴대폰 PNG나 자르기 보관함 조각을 붙여 주세요.</p>';
      return;
    }
    pieces().forEach((piece, index) => {
      const row = document.createElement('div');
      row.className = `rig-assign-row${missing.has(piece.bone) ? ' mismatch' : ''}`;

      const title = document.createElement('strong');
      title.textContent = piece.name || piece.piece;
      title.title = title.textContent;

      const boneField = document.createElement('label');
      boneField.textContent = '붙는 뼈';
      const boneSelect = document.createElement('select');
      if (missing.has(piece.bone)) {
        const option = document.createElement('option');
        option.value = piece.bone;
        option.textContent = `${piece.bone} · 없음`;
        boneSelect.appendChild(option);
      }
      for (const bone of bones()) {
        const option = document.createElement('option');
        option.value = bone.name;
        option.textContent = bone.name;
        boneSelect.appendChild(option);
      }
      boneSelect.value = piece.bone;
      boneSelect.addEventListener('change', () => {
        const before = model.snapshot();
        piece.bone = boneSelect.value;
        finishChange(before);
      });
      boneField.appendChild(boneSelect);

      const layerField = document.createElement('label');
      layerField.textContent = '층';
      const layerInput = document.createElement('input');
      layerInput.type = 'number';
      layerInput.min = '-1000';
      layerInput.max = '1000';
      layerInput.step = '1';
      layerInput.value = String(piece.zIndex);
      layerInput.addEventListener('change', () => {
        const before = model.snapshot();
        piece.zIndex = Math.max(-1000, Math.min(1000, Math.trunc(Number(layerInput.value) || 0)));
        finishChange(before);
      });
      layerField.appendChild(layerInput);

      const visible = document.createElement('button');
      visible.className = 'btn';
      visible.textContent = piece.visible === false ? '보이기' : '숨기기';
      visible.addEventListener('click', () => {
        const before = model.snapshot();
        piece.visible = piece.visible === false;
        finishChange(before);
      });

      const remove = document.createElement('button');
      remove.className = 'btn danger';
      remove.textContent = '빼기';
      remove.addEventListener('click', () => {
        const before = model.snapshot();
        pieces().splice(index, 1);
        finishChange(before);
      });

      row.append(title, boneField, layerField, visible, remove);
      assignments.appendChild(row);
    });
  }

  function renderPicker() {
    library.innerHTML = '';
    const items = model.getSliceItems();
    if (!items.length) {
      library.innerHTML = '<p class="hint">자르기 보관함에 조각이 없습니다.</p>';
      return;
    }
    for (const item of items) {
      const button = document.createElement('button');
      button.className = 'btn rig-library-choice';
      button.textContent = item.name;
      button.addEventListener('click', () => addLibraryItem(item));
      library.appendChild(button);
    }
  }

  function uniqueExtraName(base) {
    let value = base, suffix = 2;
    const used = new Set(pieces().filter(piece => piece.slot === 'extra').map(piece => piece.piece));
    while (used.has(value)) value = `${base}_${suffix++}`;
    return value;
  }

  async function addLibraryItem(item) {
    try {
      const [width, height] = model.getSize();
      if (item.width !== width || item.height !== height) {
        throw new Error(`그림 크기(${item.width}×${item.height})가 현재 판 크기(${width}×${height})와 다릅니다`);
      }
      const before = model.snapshot();
      const sourceKind = item.sourceKind === 'manual' ? 'extra' : item.sourceKind;
      const targetPiece = sourceKind === 'extra' ? uniqueExtraName(item.id) : item.piece;
      const piece = sliceLibraryItemToRigPiece(item, {
        bones: bones(), selectedBone: model.getSelectedBone(), item: model.getPresetMeta().name,
        piece: targetPiece, zIndex: nextRigZIndex(pieces()),
      });
      piece.image = await readDataUrl(piece.png);
      pieces().push(piece);
      if (pieces().length === 1 && PRESET_KINDS.includes(sourceKind)) {
        model.setPresetMeta({ ...model.getPresetMeta(), kind: sourceKind });
      }
      picker.hidden = true;
      finishChange(before);
      app.toast(`그림 「${piece.name}」을 ${piece.bone} 뼈에 붙였습니다`);
    } catch (error) {
      app.toast(error.message || '그림을 붙일 수 없습니다');
    }
  }

  async function addPhonePng() {
    try {
      const [file] = await pickFiles({ accept: 'image/png,image/*' });
      if (!file) return;
      const image = dropKey(await readImageFile(file));
      const [width, height] = model.getSize();
      if (image.width !== width || image.height !== height) {
        throw new Error(`그림 크기(${image.width}×${image.height})가 현재 판 크기(${width}×${height})와 다릅니다`);
      }
      await addLibraryItem({
        id: baseName(file.name), name: baseName(file.name), png: toPngDataUrl(image),
        width, height, sourceKind: 'manual', piece: baseName(file.name),
      });
    } catch (error) {
      app.toast(error.message || '휴대폰 PNG를 열 수 없습니다');
    }
  }

  function commitMeta() {
    const before = model.snapshot();
    const next = { id: idInput.value.trim(), name: nameInput.value.trim(), kind: kindSelect.value };
    try {
      attachedPiecesToRigPreset({ ...next, canvas: model.getSize(), pieces: pieces() });
      model.setPresetMeta(next);
      finishChange(before);
    } catch (error) {
      app.toast(error.message);
      renderMeta();
    }
  }

  async function openPreset() {
    try {
      const [file] = await pickFiles({ accept: '.json,application/json,text/plain' });
      if (!file) return;
      const preset = parsePreset(JSON.parse(await file.text()));
      const loaded = rigPresetToAttachedPieces(preset);
      for (const piece of loaded) piece.image = await readDataUrl(piece.png);
      const before = model.snapshot();
      model.setSize(preset.canvas);
      model.setPieces(loaded);
      model.setPresetMeta({ id: preset.id, name: preset.name, kind: preset.kind });
      finishChange(before);
      const check = checkRigPresetBones(preset, bones());
      app.toast(check.compatible ? `프리셋 「${preset.name}」을 열었습니다` : `프리셋을 보존해 열었습니다. 없는 뼈: ${check.missingBones.join(', ')}`);
    } catch (error) {
      app.toast(error.message || '프리셋 파일을 열 수 없습니다');
    }
  }

  async function savePreset() {
    try {
      const preset = currentPreset();
      const result = await saveJson(`${preset.id}.json`, preset);
      if (result !== 'cancelled') app.toast(`「${preset.id}.json」으로 저장했습니다`);
    } catch (error) {
      app.toast(error.message || '프리셋을 저장할 수 없습니다');
    }
  }

  $('#rig-add-piece').addEventListener('click', () => { renderPicker(); picker.hidden = false; });
  $('#rig-piece-picker-close').addEventListener('click', () => { picker.hidden = true; });
  $('#rig-piece-file').addEventListener('click', addPhonePng);
  $('#rig-preset-open').addEventListener('click', openPreset);
  $('#rig-preset-save').addEventListener('click', savePreset);
  idInput.addEventListener('change', commitMeta);
  nameInput.addEventListener('change', commitMeta);
  kindSelect.addEventListener('change', commitMeta);

  return {
    currentPreset,
    refresh() { renderMeta(); renderAssignments(); if (!picker.hidden) renderPicker(); },
  };
}
