// 뼈대 단계의 그림 넣기·프리셋 정보·preset-1 열기/저장 화면입니다.
import { PRESET_KINDS, parsePreset } from './core/preset.js';
import { sliceLibraryItemToRigPiece } from './core/slice-library.js';
import {
  attachedPiecesToRigPreset, checkRigPresetBones, nextRigZIndex,
} from './core/rig-preset.js';
import {
  addPresetToRigLayers, groupDraftRigPieces, rigLayerForPiece, rigLayerToPreset,
  uniquePresetIdFromName,
} from './core/preset-layers.js';
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
  const layerList = $('#rig-preset-layer-list');

  const pieces = () => model.getPieces();
  const bones = () => model.getBones();
  const presetLayers = () => model.getPresetLayers();
  const selectedLayerKey = () => model.getSelectedPresetLayerKey();
  const selectedLayer = () => presetLayers().find(layer => layer.key === selectedLayerKey()) || null;
  let draftName = '새 프리셋';

  function currentPreset() {
    const selected = selectedLayer();
    if (selected) return rigLayerToPreset(selected, pieces(), model.getSize());
    return attachedPiecesToRigPreset({
      ...model.getPresetMeta(), canvas: model.getSize(), pieces: pieces().filter(piece => !piece.presetLayerKey),
    });
  }

  function finishChange(before) {
    model.refreshViews();
    model.commit(before);
  }

  function renderMeta() {
    const meta = selectedLayer() || { ...model.getPresetMeta(), id: 'preset', name: draftName };
    if (idInput) idInput.value = meta.id;
    nameInput.value = meta.name;
    if (kindSelect) kindSelect.value = meta.kind || 'bare';
    const skelName = $('#rig-skeleton-name');
    if (skelName) skelName.textContent = model.getSkeletonName();
  }

  function selectLayer(key) {
    model.setSelectedPresetLayerKey(key);
    renderMeta();
    renderAssignments();
    renderLayers();
  }

  function renderLayers() {
    if (!layerList) return;
    layerList.innerHTML = '';
    const draft = document.createElement('button');
    draft.className = 'rig-layer-row rig-layer-draft';
    draft.setAttribute('aria-pressed', String(!selectedLayerKey()));
    const draftCount = pieces().filter(piece => !piece.presetLayerKey).length;
    draft.innerHTML = `<strong>새 레이어</strong><span>저장 안 됨 · 그림 ${draftCount}개</span>`;
    draft.addEventListener('click', () => selectLayer(null));
    layerList.appendChild(draft);

    [...presetLayers()].reverse().forEach(layer => {
      const index = presetLayers().indexOf(layer);
      const row = document.createElement('div');
      row.className = 'rig-layer-row';
      row.setAttribute('aria-pressed', String(selectedLayerKey() === layer.key));
      const pick = document.createElement('button');
      pick.className = 'rig-layer-pick';
      pick.innerHTML = `<strong>${index} · ${layer.name}</strong><span>${layer.id}</span>`;
      pick.addEventListener('click', () => selectLayer(selectedLayerKey() === layer.key ? null : layer.key));
      const visible = document.createElement('button');
      visible.className = 'btn small'; visible.textContent = layer.visible === false ? '보이기' : '숨기기';
      visible.addEventListener('click', () => {
        const before = model.snapshot();
        layer.visible = layer.visible === false;
        finishChange(before);
      });
      const up = document.createElement('button');
      up.className = 'btn small'; up.textContent = '▲'; up.disabled = index === presetLayers().length - 1;
      up.addEventListener('click', () => moveLayer(index, 1));
      const down = document.createElement('button');
      down.className = 'btn small'; down.textContent = '▼'; down.disabled = index === 0;
      down.addEventListener('click', () => moveLayer(index, -1));
      const remove = document.createElement('button');
      remove.className = 'btn small danger'; remove.textContent = '빼기';
      remove.addEventListener('click', () => removeLayer(layer));
      row.append(pick, visible, up, down, remove);
      layerList.appendChild(row);
    });
  }

  function moveLayer(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= presetLayers().length) return;
    const before = model.snapshot();
    const next = [...presetLayers()];
    [next[index], next[target]] = [next[target], next[index]];
    model.setPresetLayers(next);
    finishChange(before);
  }

  function removeLayer(layer) {
    const before = model.snapshot();
    model.setPresetLayers(presetLayers().filter(item => item.key !== layer.key));
    model.setPieces(pieces().filter(piece => piece.presetLayerKey !== layer.key));
    if (selectedLayerKey() === layer.key) model.setSelectedPresetLayerKey(null);
    finishChange(before);
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
    const selectedBone = model.getSelectedBone?.();
    const badge = $('#rig-selected-bone-badge');
    if (badge) badge.textContent = `선택: ${selectedBone || '없음'}`;

    const allPieces = pieces();
    if (!allPieces.length) {
      assignments.innerHTML = '<p class="hint">「그림 넣기」로 휴대폰 PNG나 자르기 보관함 조각을 붙여 주세요.</p>';
      return;
    }

    const filtered = selectedBone ? allPieces.filter(p => p.bone === selectedBone) : allPieces;
    if (!filtered.length) {
      assignments.innerHTML = `<p class="hint">「${selectedBone}」에 붙은 그림 없음.<br>「그림 넣기」로 추가하세요.</p>`;
      return;
    }

    filtered.forEach(piece => {
      const index = allPieces.indexOf(piece);
      const owner = rigLayerForPiece(piece, presetLayers());
      const editable = (piece.presetLayerKey || null) === (selectedLayerKey() || null);
      const row = document.createElement('div');
      row.className = `rig-assign-row${missing.has(piece.bone) ? ' mismatch' : ''}${editable ? '' : ' is-locked'}`;

      const title = document.createElement('strong');
      title.textContent = piece.name || piece.piece;
      title.title = title.textContent;
      const ownerBadge = document.createElement('span');
      ownerBadge.className = 'rig-piece-layer-badge';
      ownerBadge.textContent = owner ? owner.name : '새 레이어';

      const controls = document.createElement('div');
      controls.className = 'rig-assign-row-controls';

      const boneField = document.createElement('label');
      boneField.textContent = '뼈';
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
      boneSelect.disabled = !editable;
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
      layerInput.disabled = !editable;
      layerInput.addEventListener('change', () => {
        const before = model.snapshot();
        piece.zIndex = Math.max(-1000, Math.min(1000, Math.trunc(Number(layerInput.value) || 0)));
        finishChange(before);
      });
      layerField.appendChild(layerInput);

      const visible = document.createElement('button');
      visible.className = 'btn';
      visible.textContent = piece.visible === false ? '보이기' : '숨기기';
      visible.disabled = !editable;
      visible.addEventListener('click', () => {
        const before = model.snapshot();
        piece.visible = piece.visible === false;
        finishChange(before);
      });

      const remove = document.createElement('button');
      remove.className = 'btn danger';
      remove.textContent = '빼기';
      remove.disabled = !editable;
      remove.addEventListener('click', () => {
        const before = model.snapshot();
        pieces().splice(index, 1);
        finishChange(before);
      });

      const replace = document.createElement('button');
      replace.className = 'btn'; replace.textContent = '그림 바꾸기'; replace.disabled = !editable;
      replace.addEventListener('click', () => replacePieceImage(piece));

      controls.append(boneField, layerField, visible, replace, remove);
      row.append(title, ownerBadge, controls);
      assignments.appendChild(row);
    });
  }

  async function replacePieceImage(piece) {
    try {
      const [file] = await pickFiles({ accept: 'image/png,image/*' });
      if (!file) return;
      const image = dropKey(await readImageFile(file));
      const [width, height] = model.getSize();
      if (image.width !== width || image.height !== height) throw new Error(`그림 크기(${image.width}×${image.height})가 현재 판 크기(${width}×${height})와 다릅니다`);
      const before = model.snapshot();
      piece.png = toPngDataUrl(image);
      piece.image = image;
      finishChange(before);
      app.toast(`「${piece.name}」 그림을 바꿨습니다`);
    } catch (error) {
      app.toast(error.message || '그림을 바꿀 수 없습니다');
    }
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
      piece.presetLayerKey = selectedLayerKey();
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

  async function openPreset() {
    try {
      const [file] = await pickFiles({ accept: '.json,application/json,text/plain' });
      if (!file) return;
      const preset = parsePreset(JSON.parse(await file.text()));
      const [width, height] = model.getSize();
      if (pieces().length && (preset.canvas[0] !== width || preset.canvas[1] !== height)) {
        throw new Error(`프리셋 크기(${preset.canvas[0]}×${preset.canvas[1]})가 현재 판 크기(${width}×${height})와 다릅니다`);
      }
      const added = addPresetToRigLayers(presetLayers(), pieces(), preset);
      for (const piece of added.added) piece.image = await readDataUrl(piece.png);
      const before = model.snapshot();
      model.setSize(preset.canvas);
      model.setPieces(added.pieces);
      model.setPresetLayers(added.layers);
      model.setSelectedPresetLayerKey(added.layer.key);
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
      const before = model.snapshot();
      const selected = selectedLayer();
      const name = nameInput.value.trim() || '새 프리셋';
      let layer;
      if (selected) {
        selected.name = name;
        layer = selected;
        model.setPresetLayers([...presetLayers()]);
      } else {
        const meta = model.getPresetMeta();
        const id = uniquePresetIdFromName(name, presetLayers());
        const grouped = groupDraftRigPieces(presetLayers(), pieces(), { ...meta, id, name });
        model.setPresetLayers(grouped.layers);
        model.setPieces(grouped.pieces);
        model.setSelectedPresetLayerKey(grouped.layer.key);
        model.setPresetMeta({ id, name, kind: grouped.layer.kind });
        draftName = '새 프리셋';
        layer = grouped.layer;
      }
      const preset = rigLayerToPreset(layer, model.getPieces(), model.getSize());
      finishChange(before);
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
  nameInput.addEventListener('input', () => {
    if (!selectedLayer()) draftName = nameInput.value;
  });

  return {
    currentPreset,
    refresh() { renderMeta(); renderAssignments(); renderLayers(); if (!picker.hidden) renderPicker(); },
  };
}
