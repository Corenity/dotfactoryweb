// 프로젝트 설정 화면 — 프로필 선택과 기기 복제본 편집만 맡습니다.
import {
  ACTIVE_PROFILE,
  CURRENT_PROFILE,
  PROJECT_C_PROFILE_ID,
  deleteDeviceProfile,
  duplicateProfile,
  editProfile,
  listProfiles,
  normalizeProfile,
  readDeviceProfiles,
  rememberProfileId,
  saveDeviceProfile,
} from './core/profile.js';
import { pickFiles, saveJson } from './io.js';

const $ = selector => document.querySelector(selector);

function goToProfile(id) {
  rememberProfileId(localStorage, id);
  const url = new URL(location.href);
  url.searchParams.set('profile', id);
  location.assign(url.href);
}

export function mountProfileView(app) {
  const dialog = $('#profile-dialog');
  const openBtn = $('#profile-open');
  const currentName = $('#profile-current');
  const choice = $('#profile-choice');
  const source = $('#profile-source');
  const name = $('#profile-name');
  const width = $('#profile-width');
  const height = $('#profile-height');
  const deleteBtn = $('#profile-delete');
  let entries = [];

  currentName.textContent = CURRENT_PROFILE.name;

  function fillCurrent() {
    name.value = CURRENT_PROFILE.name;
    width.value = CURRENT_PROFILE.canvas[0];
    height.value = CURRENT_PROFILE.canvas[1];
    const isDevice = ACTIVE_PROFILE.source === 'device';
    source.textContent = isDevice
      ? '이 기기에 저장한 프로필입니다. 바꾸면 이 기기에 자동 보관됩니다.'
      : ACTIVE_PROFILE.source === 'emergency'
        ? '내장 파일을 읽지 못해 비상 기본값으로 열었습니다. 수정하면 기기 복제본을 만듭니다.'
        : '앱에 들어 있는 프로필입니다. 수정하면 기기 복제본을 만듭니다.';
    deleteBtn.hidden = !isDevice;
  }

  async function refreshChoices() {
    try {
      entries = await listProfiles({ storage: localStorage });
    } catch (error) {
      entries = [{ id: CURRENT_PROFILE.id, name: CURRENT_PROFILE.name, source: ACTIVE_PROFILE.source }];
      app.toast(`프로필 목록을 읽지 못했습니다: ${error.message}`);
    }
    if (!entries.some(entry => entry.id === CURRENT_PROFILE.id)) {
      entries.unshift({ id: CURRENT_PROFILE.id, name: CURRENT_PROFILE.name, source: ACTIVE_PROFILE.source });
    }
    choice.replaceChildren(...entries.map(entry => {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = `${entry.name}${entry.source === 'device' ? ' · 기기' : ' · 내장'}`;
      return option;
    }));
    choice.value = CURRENT_PROFILE.id;
  }

  function formCanvas() {
    return [Number(width.value), Number(height.value)];
  }

  function saveEdited({ bones = null } = {}) {
    try {
      let target = CURRENT_PROFILE;
      const isCopy = ACTIVE_PROFILE.source !== 'device';
      if (isCopy) {
        const usedIds = readDeviceProfiles(localStorage).map(profile => profile.id);
        target = duplicateProfile(CURRENT_PROFILE, [...entries.map(entry => entry.id), ...usedIds]);
      }
      const typedName = name.value.trim();
      const nextName = isCopy && typedName === CURRENT_PROFILE.name ? target.name : typedName;
      const edited = editProfile(target, { name: nextName, canvas: formCanvas(), bones: bones || target.bones });
      saveDeviceProfile(localStorage, edited);
      goToProfile(edited.id);
    } catch (error) {
      app.toast(`프로필을 저장하지 못했습니다: ${error.message}`);
    }
  }

  openBtn?.addEventListener('click', async () => {
    await refreshChoices();
    fillCurrent();
    dialog.showModal();
  });

  choice?.addEventListener('change', () => goToProfile(choice.value));
  $('#profile-save')?.addEventListener('click', () => saveEdited());
  $('#profile-save-bones')?.addEventListener('click', () => {
    const basis = app.getRigBasis?.();
    if (!basis?.bones?.length) return app.toast('저장할 뼈대가 없습니다');
    saveEdited({ bones: basis.bones });
  });

  $('#profile-duplicate')?.addEventListener('click', () => {
    try {
      const usedIds = entries.map(entry => entry.id);
      const copy = duplicateProfile(CURRENT_PROFILE, usedIds);
      saveDeviceProfile(localStorage, copy);
      goToProfile(copy.id);
    } catch (error) {
      app.toast(`프로필을 복제하지 못했습니다: ${error.message}`);
    }
  });

  deleteBtn?.addEventListener('click', () => {
    if (ACTIVE_PROFILE.source !== 'device') return;
    if (!confirm(`기기 프로필 「${CURRENT_PROFILE.name}」을 지울까요? 내려받지 않은 설정은 되살릴 수 없습니다.`)) return;
    try {
      deleteDeviceProfile(localStorage, CURRENT_PROFILE.id);
      goToProfile(PROJECT_C_PROFILE_ID);
    } catch (error) {
      app.toast(`프로필을 지우지 못했습니다: ${error.message}`);
    }
  });

  $('#profile-download')?.addEventListener('click', async () => {
    const result = await saveJson(`${CURRENT_PROFILE.id}.profile.json`, CURRENT_PROFILE);
    if (result !== 'cancelled') app.toast('프로필 JSON을 남겼습니다');
  });

  $('#profile-import')?.addEventListener('click', async () => {
    try {
      const [file] = await pickFiles({ accept: '.json,application/json,text/plain' });
      if (!file) return;
      const profile = normalizeProfile(JSON.parse(await file.text()));
      saveDeviceProfile(localStorage, profile);
      goToProfile(profile.id);
    } catch (error) {
      app.toast(`프로필을 불러오지 못했습니다: ${error.message}`);
    }
  });

  return { open: () => openBtn?.click() };
}
