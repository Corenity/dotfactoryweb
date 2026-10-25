// 자동 저장 — 브라우저 저장소(localStorage)에 마지막 작업 하나를 둡니다. 내려받기를 대신하지 않습니다.
import { cleanColors } from './core/paint.js';
import { LEGACY_AUTOSAVE_KEY, PROJECT_C_PROFILE_ID, copyLegacyAutosaveToProfile, profileAutosaveKey } from './core/profile.js';

// 내 색은 그림과 따로 둡니다. 새 그림을 열어도 남지만, 아이폰이 사이트 자료를 지우면 함께 사라질 수 있습니다.
const COLORS_KEY = 'dotfactory-web/my-colors-1';
let timer = 0;
let autosaveKey = LEGACY_AUTOSAVE_KEY;
let fallbackKey = '';
let autosaveStorage = null;

function workStorage() {
  return autosaveStorage || localStorage;
}

export function configureProfileAutosave(id, storage = localStorage) {
  clearTimeout(timer);
  autosaveStorage = storage;
  autosaveKey = profileAutosaveKey(id);
  fallbackKey = '';
  let migration = { copied: false, reason: 'not-project-c', sourceKey: LEGACY_AUTOSAVE_KEY, targetKey: autosaveKey };
  if (id === PROJECT_C_PROFILE_ID) {
    try {
      migration = copyLegacyAutosaveToProfile(storage, id);
    } catch (error) {
      fallbackKey = LEGACY_AUTOSAVE_KEY;
      migration = { copied: false, reason: 'copy-failed', error, sourceKey: LEGACY_AUTOSAVE_KEY, targetKey: autosaveKey };
    }
  }
  return { key: autosaveKey, fallbackKey, migration };
}

export function resetAutosaveConfiguration() {
  clearTimeout(timer);
  autosaveStorage = null;
  autosaveKey = LEGACY_AUTOSAVE_KEY;
  fallbackKey = '';
}

export function saveLater(value) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { workStorage().setItem(autosaveKey, JSON.stringify(value)); } catch { /* 저장소가 가득 차면 자동 저장만 건너뜁니다 */ }
  }, 800);
}

export function saveNow(value) {
  clearTimeout(timer);
  workStorage().setItem(autosaveKey, JSON.stringify(value));
}

export function saveVerifiedMigration(migration) {
  if (migration?.report?.verified !== true || !migration.value) {
    throw new Error('검증되지 않은 자동 보관 변환은 저장할 수 없습니다');
  }
  saveNow(migration.value);
}

export async function loadSaved() {
  const storage = workStorage();
  const text = storage.getItem(autosaveKey) || (fallbackKey ? storage.getItem(fallbackKey) : null);
  return text ? JSON.parse(text) : null;
}

export function loadColors() {
  try { return cleanColors(JSON.parse(localStorage.getItem(COLORS_KEY) || '[]')); } catch { return []; }
}

export function saveColors(list) {
  try { localStorage.setItem(COLORS_KEY, JSON.stringify(list)); } catch { /* 저장소가 가득 차면 이번 판에서만 남습니다 */ }
}
