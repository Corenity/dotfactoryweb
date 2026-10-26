// 뼈대 단계의 그림 넣기·프리셋/그룹 정보·preset-1 열기/저장 화면입니다.
import { parsePreset } from './core/preset.js';
import {
  attachedPiecesToRigPreset, checkRigPresetBones, nextRigZIndex,
} from './core/rig-preset.js';
import {
  addPresetToRigLayers, groupDraftRigPieces, rigLayerToPreset,
  toggleGroupLayerVisibility, ungroupRigPresetLayer, uniquePresetIdFromName,
  updateGroupPieces, rigPieceKey,
} from './core/preset-layers.js';
import { dropKey } from './core/paint.js';
import { pickFiles, readImageFile, readDataUrl, toPngDataUrl, saveJson, baseName } from './io.js';

const $ = selector => document.querySelector(selector);

export function rigVisibilityModeForTab(tab) {
  return tab === 'groups' ? 'group' : 'individual';
}

export function mountRigPreset(app, model) {
  const warning = $('#rig-preset-warning');

  // 왼쪽 메뉴 탭 및 패널
  const tabBones = $('#rig-tab-bones');
  const tabGroups = $('#rig-tab-groups');
  const panelBones = $('#rig-panel-bones');
  const panelGroups = $('#rig-panel-groups');

  // 그룹 패널 요소들
  const groupList = $('#rig-group-list');
  const groupPlusWrap = $('.rig-group-plus-wrap');
  const groupPlusBtn = $('#rig-group-plus-btn');
  const groupPlusMenu = $('#rig-group-plus-menu');
  const groupAddBtn = $('#rig-group-add-btn');
  const groupImportBtn = $('#rig-group-import-btn');
  const groupDeleteBtn = $('#rig-group-delete-btn');
  const groupSaveBtn = $('#rig-group-save-btn');
  const groupEditBtn = $('#rig-group-edit-btn');

  // 그룹 추가 모달
  const groupAddPop = $('#rig-group-add-pop');
  const groupAddCloseBtn = $('#rig-group-add-close');
  const groupDraftPieces = $('#rig-group-draft-pieces');
  const newGroupNameInput = $('#rig-new-group-name');
  const groupCreateConfirmBtn = $('#rig-group-create-confirm');
  const groupAddCancelBtn = $('#rig-group-add-cancel');

  // 그룹 편집 모달
  const groupEditPop = $('#rig-group-edit-pop');
  const groupEditCloseBtn = $('#rig-group-edit-close');
  const groupEditDoneBtn = $('#rig-group-edit-done');
  const editGroupNameInput = $('#rig-edit-group-name');
  const groupEditRenameBtn = $('#rig-group-edit-rename');
  const groupMemberPieces = $('#rig-group-member-pieces');
  const groupAvailPieces = $('#rig-group-avail-pieces');

  const pieces = () => model.getPieces();
  const bones = () => model.getBones();
  const presetLayers = () => model.getPresetLayers();
  const selectedLayerKey = () => model.getSelectedPresetLayerKey();
  const selectedLayer = () => presetLayers().find(layer => layer.key === selectedLayerKey()) || null;

  let selectedGroupKey = null;
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

  function switchLeftTab(tab) {
    if (tabBones) {
      tabBones.setAttribute('aria-pressed', String(tab === 'bones'));
    }
    if (tabGroups) {
      tabGroups.setAttribute('aria-pressed', String(tab === 'groups'));
    }
    if (panelBones) panelBones.hidden = tab !== 'bones';
    if (panelGroups) {
      panelGroups.hidden = tab !== 'groups';
      if (tab === 'groups') renderGroupList();
    }
    model.setVisibilityMode?.(rigVisibilityModeForTab(tab));
    model.refreshViews?.();
    window.dispatchEvent(new CustomEvent('rig-tab-change', { detail: { tab } }));
  }

  function syncVisibilityModeToActiveTab() {
    const tab = tabGroups?.getAttribute('aria-pressed') === 'true' ? 'groups' : 'bones';
    model.setVisibilityMode?.(rigVisibilityModeForTab(tab));
  }

  function positionGroupPlusMenu() {
    if (!groupPlusBtn || !groupPlusMenu || groupPlusMenu.hidden) return;
    const buttonRect = groupPlusBtn.getBoundingClientRect();
    const menuWidth = groupPlusMenu.offsetWidth;
    const menuHeight = groupPlusMenu.offsetHeight;
    const left = Math.max(4, Math.min(buttonRect.left, window.innerWidth - menuWidth - 4));
    const top = Math.max(4, buttonRect.top - menuHeight - 4);
    groupPlusMenu.style.left = `${left}px`;
    groupPlusMenu.style.top = `${top}px`;
  }

  function updateActionButtons() {
    const hasSelected = Boolean(selectedGroupKey && presetLayers().some(l => l.key === selectedGroupKey));
    if (groupDeleteBtn) groupDeleteBtn.disabled = !hasSelected;
    if (groupSaveBtn) groupSaveBtn.disabled = !hasSelected;
    if (groupEditBtn) groupEditBtn.disabled = !hasSelected;
  }

  function renderGroupList() {
    if (!groupList) return;
    groupList.innerHTML = '';
    const layers = presetLayers();
    if (selectedGroupKey && !layers.some(l => l.key === selectedGroupKey)) {
      selectedGroupKey = null;
    }
    if (!layers.length) {
      groupList.innerHTML = '<p class="hint">등록된 그룹이 없습니다.</p>';
      updateActionButtons();
      return;
    }

    layers.forEach(layer => {
      const card = document.createElement('div');
      card.className = 'rig-group-card' + (layer.key === selectedGroupKey ? ' selected' : '');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.dataset.key = layer.key;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'rig-group-name';
      nameSpan.textContent = layer.name;
      nameSpan.title = layer.name;

      const isVis = layer.visible !== false;
      const visBtn = document.createElement('button');
      visBtn.type = 'button';
      visBtn.className = 'btn icon rig-group-vis-btn';
      visBtn.setAttribute('aria-pressed', String(isVis));
      visBtn.setAttribute('aria-label', `${layer.name} ${isVis ? '숨기기' : '보이기'}`);
      visBtn.title = isVis ? '숨기기' : '보이기';
      visBtn.innerHTML = isVis
        ? '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>'
        : '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" fill="none" stroke="currentColor" stroke-width="2"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2"/></svg>';

      visBtn.addEventListener('click', e => {
        e.stopPropagation();
        const before = model.snapshot();
        const nextLayers = toggleGroupLayerVisibility(presetLayers(), layer.key);
        model.setPresetLayers(nextLayers);
        model.setVisibilityMode?.('group');
        finishChange(before);
        renderGroupList();
      });

      card.addEventListener('click', () => {
        selectedGroupKey = layer.key;
        renderGroupList();
      });

      card.append(nameSpan, visBtn);
      groupList.appendChild(card);
    });

    updateActionButtons();
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
      const pieceIndex = pieces().indexOf(p);
      const key = rigPieceKey(p, pieceIndex);
      const label = document.createElement('label');
      label.className = 'rig-piece-check-item';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = true;
      chk.dataset.pieceId = key;
      const text = document.createElement('span');
      text.textContent = `${p.name || p.piece} (${p.bone}, 깊이: ${p.zIndex})`;
      label.append(chk, text);
      groupDraftPieces.appendChild(label);
    });
  }

  function renderGroupEditView() {
    const layer = presetLayers().find(l => l.key === editingGroupKey);
    if (!layer) {
      if (groupEditPop) groupEditPop.hidden = true;
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
          const pieceIndex = pieces().indexOf(p);
          const key = rigPieceKey(p, pieceIndex);
          const row = document.createElement('div');
          row.className = 'rig-piece-member-item';
          const nameSpan = document.createElement('span');
          nameSpan.textContent = `${p.name || p.piece} (${p.bone}, 깊이: ${p.zIndex})`;
          const dropBtn = document.createElement('button');
          dropBtn.type = 'button';
          dropBtn.className = 'btn small danger';
          dropBtn.textContent = '빼기';
          dropBtn.addEventListener('click', () => {
            const before = model.snapshot();
            const nextPieces = updateGroupPieces(pieces(), layer.key, { removePieceIds: [key] });
            model.setPieces(nextPieces);
            finishChange(before);
            renderGroupEditView();
            renderGroupList();
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
          const pieceIndex = pieces().indexOf(p);
          const key = rigPieceKey(p, pieceIndex);
          const row = document.createElement('div');
          row.className = 'rig-piece-member-item';
          const nameSpan = document.createElement('span');
          nameSpan.textContent = `${p.name || p.piece} (${p.bone}, 깊이: ${p.zIndex})`;
          const addBtn = document.createElement('button');
          addBtn.type = 'button';
          addBtn.className = 'btn small primary';
          addBtn.textContent = '추가';
          addBtn.addEventListener('click', () => {
            const before = model.snapshot();
            const nextPieces = updateGroupPieces(pieces(), layer.key, { addPieceIds: [key] });
            model.setPieces(nextPieces);
            finishChange(before);
            renderGroupEditView();
            renderGroupList();
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
      selectedGroupKey = added.layer.key;
      finishChange(before);
      renderGroupList();
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

  function bindEvents() {
    $('#rig-add-piece')?.addEventListener('click', addPhonePng);
    $('#rig-preset-open')?.addEventListener('click', openPreset);
    $('#rig-preset-save')?.addEventListener('click', savePreset);

    // 왼쪽 메뉴 탭 전환
    tabBones?.addEventListener('click', () => switchLeftTab('bones'));
    tabGroups?.addEventListener('click', () => switchLeftTab('groups'));

    // + 메뉴 팝업 토글 및 외부 클릭 닫기
    groupPlusBtn?.addEventListener('click', e => {
      e.stopPropagation();
      if (!groupPlusMenu) return;
      const willOpen = groupPlusMenu.hidden;
      groupPlusMenu.hidden = !willOpen;
      groupPlusBtn.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) positionGroupPlusMenu();
    });

    window.addEventListener('resize', positionGroupPlusMenu);

    document.addEventListener('click', e => {
      if (groupPlusMenu && !groupPlusMenu.hidden) {
        if (!groupPlusWrap?.contains(e.target)) {
          groupPlusMenu.hidden = true;
          groupPlusBtn?.setAttribute('aria-expanded', 'false');
        }
      }
    });

    // + 메뉴의 추가하기 / 불러오기
    groupAddBtn?.addEventListener('click', () => {
      if (groupPlusMenu) {
        groupPlusMenu.hidden = true;
        groupPlusBtn?.setAttribute('aria-expanded', 'false');
      }
      renderGroupAddView();
      if (groupAddPop) groupAddPop.hidden = false;
    });

    groupImportBtn?.addEventListener('click', () => {
      if (groupPlusMenu) {
        groupPlusMenu.hidden = true;
        groupPlusBtn?.setAttribute('aria-expanded', 'false');
      }
      openPreset();
    });

    // 그룹 추가 팝업
    groupAddCloseBtn?.addEventListener('click', () => {
      if (groupAddPop) groupAddPop.hidden = true;
    });
    groupAddCancelBtn?.addEventListener('click', () => {
      if (groupAddPop) groupAddPop.hidden = true;
    });

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
        selectedGroupKey = grouped.layer.key;
        finishChange(before);
        app.toast(`그룹 「${name}」을 만들었습니다`);
        if (groupAddPop) groupAddPop.hidden = true;
        renderGroupList();
      } catch (err) {
        app.toast(err.message || '그룹 생성 실패');
      }
    });

    // 그룹 삭제 (묶음만 풀기)
    groupDeleteBtn?.addEventListener('click', () => {
      const layer = presetLayers().find(l => l.key === selectedGroupKey);
      if (!layer) return;
      const before = model.snapshot();
      const result = ungroupRigPresetLayer(presetLayers(), pieces(), layer.key);
      model.setPresetLayers(result.layers);
      model.setPieces(result.pieces);
      selectedGroupKey = null;
      finishChange(before);
      app.toast(`그룹 「${layer.name}」을 풀었습니다`);
      renderGroupList();
    });

    // 그룹 저장 (preset-1 JSON 내려받기)
    groupSaveBtn?.addEventListener('click', async () => {
      const layer = presetLayers().find(l => l.key === selectedGroupKey);
      if (!layer) return;
      try {
        const preset = rigLayerToPreset(layer, pieces(), model.getSize());
        const fileName = `${layer.id || layer.name}.json`;
        const result = await saveJson(fileName, preset);
        if (result !== 'cancelled') app.toast(`「${fileName}」으로 저장했습니다`);
      } catch (err) {
        app.toast(err.message || '그룹 저장 실패');
      }
    });

    // 그룹 편집
    groupEditBtn?.addEventListener('click', () => {
      const layer = presetLayers().find(l => l.key === selectedGroupKey);
      if (!layer) return;
      editingGroupKey = layer.key;
      renderGroupEditView();
      if (groupEditPop) groupEditPop.hidden = false;
    });

    groupEditCloseBtn?.addEventListener('click', () => {
      if (groupEditPop) groupEditPop.hidden = true;
    });
    groupEditDoneBtn?.addEventListener('click', () => {
      if (groupEditPop) groupEditPop.hidden = true;
    });

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
      renderGroupList();
    });
  }

  bindEvents();

  return {
    currentPreset,
    syncVisibilityModeToActiveTab,
    refresh() {
      renderWarning();
      renderGroupList();
      if (groupEditPop && !groupEditPop.hidden) renderGroupEditView();
    },
  };
}
