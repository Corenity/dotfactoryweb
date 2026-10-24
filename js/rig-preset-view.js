// 뼈대 단계의 그림 넣기·프리셋/그룹 정보·preset-1 열기/저장 화면입니다.
import { PRESET_KINDS, parsePreset } from './core/preset.js';
import {
  attachedPiecesToRigPreset, checkRigPresetBones, nextRigZIndex,
} from './core/rig-preset.js';
import {
  addPresetToRigLayers, groupDraftRigPieces, groupVisibilityState, rigLayerForPiece,
  rigLayerToPreset, toggleGroupVisibility, toggleGroupLayerVisibility, ungroupRigPresetLayer, uniquePresetIdFromName,
  updateGroupPieces,
} from './core/preset-layers.js';
import { dropKey } from './core/paint.js';
import { pickFiles, readImageFile, readDataUrl, toPngDataUrl, saveJson, baseName } from './io.js';

const $ = selector => document.querySelector(selector);

export function mountRigPreset(app, model) {
  const warning = $('#rig-preset-warning');

  // 그룹화 모달
  const groupPop = $('#rig-group-pop');
  const groupBtn = $('#rig-group-btn');
  const groupPopCloseBtn = $('#rig-group-pop-close');
  const groupList = $('#rig-group-list');
  const groupAddBtn = $('#rig-group-add-btn');
  const groupImportBtn = $('#rig-group-import-btn');

  const groupViewList = $('#rig-group-view-list');
  const groupViewAdd = $('#rig-group-view-add');
  const groupViewEdit = $('#rig-group-view-edit');

  const groupDraftPieces = $('#rig-group-draft-pieces');
  const newGroupNameInput = $('#rig-new-group-name');
  const groupCreateConfirmBtn = $('#rig-group-create-confirm');
  const groupAddCancelBtn = $('#rig-group-add-cancel');

  const editGroupNameInput = $('#rig-edit-group-name');
  const groupEditRenameBtn = $('#rig-group-edit-rename');
  const groupMemberPieces = $('#rig-group-member-pieces');
  const groupAvailPieces = $('#rig-group-avail-pieces');
  const groupUngroupBtn = $('#rig-group-ungroup-btn');
  const groupEditBackBtn = $('#rig-group-edit-back');

  const pieces = () => model.getPieces();
  const bones = () => model.getBones();
  const presetLayers = () => model.getPresetLayers();
  const selectedLayerKey = () => model.getSelectedPresetLayerKey();
  const selectedLayer = () => presetLayers().find(layer => layer.key === selectedLayerKey()) || null;

  let editingGroupKey = null;

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

  function switchGroupView(view) {
    if (groupViewList) groupViewList.hidden = view !== 'list';
    if (groupViewAdd) groupViewAdd.hidden = view !== 'add';
    if (groupViewEdit) groupViewEdit.hidden = view !== 'edit';
    if (view === 'list') renderGroupList();
    else if (view === 'add') renderGroupAddView();
    else if (view === 'edit') renderGroupEditView();
  }

  function renderGroupList() {
    if (!groupList) return;
    groupList.innerHTML = '';
    const layers = presetLayers();
    if (!layers.length) {
      groupList.innerHTML = '<p class="hint">등록된 그룹이 없습니다. 「그룹 추가하기」로 그림을 묶어 보세요.</p>';
      return;
    }

    layers.forEach(layer => {
      const row = document.createElement('div');
      row.className = 'rig-group-item';

      const memberCount = pieces().filter(p => p.presetLayerKey === layer.key).length;
      const isVis = layer.visible !== false;
      const visState = isVis ? 'all' : 'none';
      const visLabel = isVis ? '보임' : '숨김';

      const info = document.createElement('div');
      info.className = 'rig-group-info';
      info.innerHTML = `<div class="rig-group-title">${layer.name} <span class="rig-group-badge ${visState}">${visLabel}</span></div><div class="rig-group-meta">그림 ${memberCount}개 · ${layer.id}</div>`;

      const actions = document.createElement('div');
      actions.className = 'rig-group-actions';

      const visBtn = document.createElement('button');
      visBtn.className = 'btn small';
      visBtn.textContent = isVis ? '숨기기' : '보이기';
      visBtn.addEventListener('click', () => {
        const before = model.snapshot();
        const nextLayers = toggleGroupLayerVisibility(presetLayers(), layer.key);
        model.setPresetLayers(nextLayers);
        model.setVisibilityMode?.('group');
        updateViewModeBadge();
        finishChange(before);
        renderGroupList();
      });

      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn small primary';
      saveBtn.textContent = '그룹 저장';
      saveBtn.title = 'preset-1 JSON 파일로 내려받기';
      saveBtn.addEventListener('click', async () => {
        try {
          const preset = rigLayerToPreset(layer, pieces(), model.getSize());
          const fileName = `${layer.id || layer.name}.json`;
          const result = await saveJson(fileName, preset);
          if (result !== 'cancelled') app.toast(`「${fileName}」으로 저장했습니다`);
        } catch (err) {
          app.toast(err.message || '그룹 저장 실패');
        }
      });

      const editBtn = document.createElement('button');
      editBtn.className = 'btn small';
      editBtn.textContent = '편집';
      editBtn.addEventListener('click', () => {
        editingGroupKey = layer.key;
        switchGroupView('edit');
      });

      actions.append(visBtn, saveBtn, editBtn);
      row.append(info, actions);
      groupList.appendChild(row);
    });
  }

  function renderGroupAddView() {
    if (!groupDraftPieces) return;
    groupDraftPieces.innerHTML = '';
    if (newGroupNameInput) newGroupNameInput.value = '새 그룹';
    const drafts = pieces().filter(p => !p.presetLayerKey);
    if (!drafts.length) {
      groupDraftPieces.innerHTML = '<p class="hint">어느 그룹에도 안 든 그림이 없습니다.</p>';
      return;
    }

    drafts.forEach(p => {
      const label = document.createElement('label');
      label.className = 'rig-piece-check-item';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = true;
      chk.dataset.pieceId = p.id || p.name;
      const text = document.createElement('span');
      text.textContent = `${p.name || p.piece} (${p.bone}, 깊이: ${p.zIndex})`;
      label.append(chk, text);
      groupDraftPieces.appendChild(label);
    });
  }

  function renderGroupEditView() {
    const layer = presetLayers().find(l => l.key === editingGroupKey);
    if (!layer) {
      switchGroupView('list');
      return;
    }
    if (editGroupNameInput) editGroupNameInput.value = layer.name;

    if (groupMemberPieces) {
      groupMemberPieces.innerHTML = '';
      const members = pieces().filter(p => p.presetLayerKey === layer.key);
      if (!members.length) {
        groupMemberPieces.innerHTML = '<p class="hint">소속된 그림이 없습니다.</p>';
      } else {
        members.forEach(p => {
          const row = document.createElement('div');
          row.className = 'rig-piece-member-item';
          const nameSpan = document.createElement('span');
          nameSpan.textContent = `${p.name || p.piece} (${p.bone}, 깊이: ${p.zIndex})`;
          const dropBtn = document.createElement('button');
          dropBtn.className = 'btn small danger';
          dropBtn.textContent = '빼기';
          dropBtn.addEventListener('click', () => {
            const before = model.snapshot();
            const nextPieces = updateGroupPieces(pieces(), layer.key, { removePieceIds: [p.id || p.name] });
            model.setPieces(nextPieces);
            finishChange(before);
            renderGroupEditView();
          });
          row.append(nameSpan, dropBtn);
          groupMemberPieces.appendChild(row);
        });
      }
    }

    if (groupAvailPieces) {
      groupAvailPieces.innerHTML = '';
      const drafts = pieces().filter(p => !p.presetLayerKey);
      if (!drafts.length) {
        groupAvailPieces.innerHTML = '<p class="hint">추가할 수 있는 미소속 그림이 없습니다.</p>';
      } else {
        drafts.forEach(p => {
          const row = document.createElement('div');
          row.className = 'rig-piece-member-item';
          const nameSpan = document.createElement('span');
          nameSpan.textContent = `${p.name || p.piece} (${p.bone}, 깊이: ${p.zIndex})`;
          const addBtn = document.createElement('button');
          addBtn.className = 'btn small primary';
          addBtn.textContent = '추가';
          addBtn.addEventListener('click', () => {
            const before = model.snapshot();
            const nextPieces = updateGroupPieces(pieces(), layer.key, { addPieceIds: [p.id || p.name] });
            model.setPieces(nextPieces);
            finishChange(before);
            renderGroupEditView();
          });
          row.append(nameSpan, addBtn);
          groupAvailPieces.appendChild(row);
        });
      }
    }
  }

  function renderWarning(preset = null) {
    if (!warning) return new Set();
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

  function uniqueExtraName(base) {
    let value = base, suffix = 2;
    const used = new Set(pieces().filter(piece => piece.slot === 'extra').map(piece => piece.piece));
    while (used.has(value)) value = `${base}_${suffix++}`;
    return value;
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
      const before = model.snapshot();
      const name = baseName(file.name);
      const safeName = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'piece';
      const pieceName = uniqueExtraName(safeName);
      const bone = model.getSelectedBone?.() || bones()[0]?.name;
      if (!bone) throw new Error('그림을 붙일 뼈가 없습니다');
      pieces().push({
        slot: 'extra', item: model.getPresetMeta().name, piece: pieceName, name,
        bone, zIndex: nextRigZIndex(pieces()), visible: true,
        png: toPngDataUrl(image), image, presetLayerKey: null,
      });
      finishChange(before);
      app.toast(`그림 「${name}」을 ${bone} 뼈에 붙였습니다`);
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
      if (!groupPop?.hidden) renderGroupList();
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
      const nameInput = $('#rig-preset-name');
      const name = (nameInput?.value || '').trim() || '새 프리셋';
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


  function updateViewModeBadge() {
    const badge = $('#rig-view-mode-btn');
    if (!badge) return;
    const mode = model.getVisibilityMode?.() || 'individual';
    badge.textContent = mode === 'group' ? '보기: 그룹' : '보기: 개별';
    badge.title = '보기 방식 전환 (현재: ' + (mode === 'group' ? '그룹 보기' : '개별 보기') + ')';
    badge.setAttribute('aria-pressed', String(mode === 'group'));
  }

  function bindEvents() {
    $('#rig-view-mode-btn')?.addEventListener('click', () => {
      const before = model.snapshot();
      const current = model.getVisibilityMode?.() || 'individual';
      model.setVisibilityMode?.(current === 'group' ? 'individual' : 'group');
      updateViewModeBadge();
      finishChange(before);
    });
    $('#rig-add-piece')?.addEventListener('click', addPhonePng);
    $('#rig-preset-open')?.addEventListener('click', openPreset);
    $('#rig-preset-save')?.addEventListener('click', savePreset);

    // 그룹화 모달
    groupBtn?.addEventListener('click', () => {
      if (groupPop) {
        groupPop.hidden = false;
        switchGroupView('list');
      }
    });
    groupPopCloseBtn?.addEventListener('click', () => {
      if (groupPop) groupPop.hidden = true;
    });
    groupAddBtn?.addEventListener('click', () => switchGroupView('add'));
    groupImportBtn?.addEventListener('click', openPreset);

    groupCreateConfirmBtn?.addEventListener('click', () => {
      const name = (newGroupNameInput?.value || '').trim() || '새 그룹';
      const checks = groupDraftPieces?.querySelectorAll('input[type="checkbox"]:checked') || [];
      const selectedIds = [...checks].map(c => c.dataset.pieceId);
      if (!selectedIds.length) {
        app.toast('그룹으로 묶을 그림을 하나 이상 선택해 주세요');
        return;
      }
      const before = model.snapshot();
      try {
        const id = uniquePresetIdFromName(name, presetLayers());
        const grouped = groupDraftRigPieces(presetLayers(), pieces(), { id, name, kind: 'bare' }, selectedIds);
        model.setPresetLayers(grouped.layers);
        model.setPieces(grouped.pieces);
        finishChange(before);
        app.toast(`그룹 「${name}」을 만들었습니다`);
        switchGroupView('list');
      } catch (err) {
        app.toast(err.message || '그룹 생성 실패');
      }
    });

    groupAddCancelBtn?.addEventListener('click', () => switchGroupView('list'));

    groupEditRenameBtn?.addEventListener('click', () => {
      const layer = presetLayers().find(l => l.key === editingGroupKey);
      if (!layer) return;
      const nextName = (editGroupNameInput?.value || '').trim();
      if (!nextName) {
        app.toast('그룹 이름을 입력해 주세요');
        return;
      }
      const before = model.snapshot();
      layer.name = nextName;
      model.setPresetLayers([...presetLayers()]);
      finishChange(before);
      app.toast('그룹 이름을 변경했습니다');
      renderGroupEditView();
    });

    groupUngroupBtn?.addEventListener('click', () => {
      const layer = presetLayers().find(l => l.key === editingGroupKey);
      if (!layer) return;
      const before = model.snapshot();
      const result = ungroupRigPresetLayer(presetLayers(), pieces(), layer.key);
      model.setPresetLayers(result.layers);
      model.setPieces(result.pieces);
      finishChange(before);
      app.toast(`그룹 「${layer.name}」을 풀었습니다`);
      switchGroupView('list');
    });

    groupEditBackBtn?.addEventListener('click', () => switchGroupView('list'));
  }

  bindEvents();

  return {
    currentPreset,
    refresh() {
      renderWarning();
      if (groupPop && !groupPop.hidden) renderGroupList();
    },
  };
}
