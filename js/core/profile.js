// 도트 공장 프로젝트 프로필 — DOM 없이 브라우저와 Node에서 같은 JSON을 읽고 검사합니다.

export const PROFILE_SCHEMA = 'dotfactory-web/profile-1';
export const PROFILE_INDEX_SCHEMA = 'dotfactory-web/profile-index-1';
export const PROJECT_C_PROFILE_ID = 'project-c';
export const LEGACY_AUTOSAVE_KEY = 'dotfactory-web/autosave-1';

const PROFILE_ROOT = new URL('../../profiles/', import.meta.url);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const PART_PATTERN = /^[a-z0-9_]+$/;
const BONE_PATTERN = /^[A-Za-z0-9_]+$/;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 자료가 올바르지 않습니다`);
  return value;
}

function text(value, label, pattern = null) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${label} 값이 비었습니다`);
  if (pattern && !pattern.test(result)) throw new Error(`${label} 「${result}」 형식이 올바르지 않습니다`);
  return result;
}

function integer(value, label, { min = -Infinity, max = Infinity } = {}) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`${label} 값(${value})이 올바르지 않습니다`);
  return result;
}

function pair(value, label) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label} 값은 숫자 2개 배열이어야 합니다`);
  return [integer(value[0], `${label} 첫째 값`), integer(value[1], `${label} 둘째 값`)];
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeBones(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('기본 뼈 목록이 비었습니다');
  const names = new Set();
  const labels = {};
  const bones = value.map((raw, index) => {
    object(raw, `기본 뼈 #${index + 1}`);
    const name = text(raw.name, `기본 뼈 #${index + 1} 이름`, BONE_PATTERN);
    if (names.has(name)) throw new Error(`기본 뼈 이름 「${name}」이 겹칩니다`);
    names.add(name);
    const parent = raw.parent == null || raw.parent === '' ? null : text(raw.parent, `기본 뼈 「${name}」 부모`, BONE_PATTERN);
    const pos = pair(raw.pos, `기본 뼈 「${name}」 위치`);
    const angle = Number(raw.angle ?? 90);
    const length = Number(raw.length ?? 4);
    if (!Number.isFinite(angle)) throw new Error(`기본 뼈 「${name}」 각도가 올바르지 않습니다`);
    if (!Number.isFinite(length) || length < 0) throw new Error(`기본 뼈 「${name}」 길이가 올바르지 않습니다`);
    labels[name] = String(raw.label || name);
    return { name, parent, pos, angle, length };
  });
  const byName = new Map(bones.map(bone => [bone.name, bone]));
  for (const bone of bones) {
    if (bone.parent && !byName.has(bone.parent)) throw new Error(`기본 뼈 「${bone.name}」의 부모 「${bone.parent}」가 없습니다`);
    const seen = new Set([bone.name]);
    let current = bone;
    while (current.parent) {
      if (seen.has(current.parent)) throw new Error(`기본 뼈 「${bone.name}」의 부모 관계가 원을 이룹니다`);
      seen.add(current.parent);
      current = byName.get(current.parent);
    }
  }
  return { bones, labels };
}

function normalizeBoneLabels(value, defaults) {
  if (value == null) return defaults;
  object(value, '뼈 표시 이름');
  const labels = { ...defaults };
  for (const [name, label] of Object.entries(value)) {
    text(name, '뼈 표시 이름의 뼈', BONE_PATTERN);
    labels[name] = text(label, `뼈 「${name}」 표시 이름`);
  }
  return labels;
}

function normalizeZOrder(value) {
  object(value, '겹침 순서');
  const result = {};
  for (const [key, zIndex] of Object.entries(value)) {
    text(key, '겹침 순서 조각 id', PART_PATTERN);
    result[key] = integer(zIndex, `겹침 순서 「${key}」`, { min: -1000, max: 1000 });
  }
  return result;
}

function normalizeBareLayers(value, boneNames) {
  if (!Array.isArray(value)) throw new Error('맨몸 그림 목록이 올바르지 않습니다');
  const ids = new Set();
  return value.map((raw, index) => {
    object(raw, `맨몸 그림 #${index + 1}`);
    const id = text(raw.id, `맨몸 그림 #${index + 1} id`, PART_PATTERN);
    if (!id.includes('_')) throw new Error(`맨몸 그림 id 「${id}」는 종류_이름 형태여야 합니다`);
    if (ids.has(id)) throw new Error(`맨몸 그림 id 「${id}」가 겹칩니다`);
    ids.add(id);
    const bone = text(raw.bone, `맨몸 그림 「${id}」 뼈`, BONE_PATTERN);
    if (!boneNames.has(bone)) throw new Error(`맨몸 그림 「${id}」의 뼈 「${bone}」가 없습니다`);
    return {
      id, bone,
      zIndex: integer(raw.zIndex, `맨몸 그림 「${id}」 zIndex`, { min: -1000, max: 1000 }),
      file: text(raw.file, `맨몸 그림 「${id}」 파일`),
    };
  });
}

export function normalizeProfile(value) {
  const raw = object(value, '프로필');
  if (raw.schema !== PROFILE_SCHEMA) throw new Error(`프로필 schema는 ${PROFILE_SCHEMA}여야 합니다`);
  const id = text(raw.id, '프로필 id', ID_PATTERN);
  const name = text(raw.name, '프로필 이름');
  const canvas = pair(raw.canvas, '그림판 크기');
  if (canvas[0] <= 0 || canvas[1] <= 0 || canvas[0] > 4096 || canvas[1] > 4096) throw new Error('그림판 크기는 1~4096 사이여야 합니다');
  const normalizedBones = normalizeBones(raw.bones);
  const boneNames = new Set(normalizedBones.bones.map(bone => bone.name));
  const fallbackBone = text(raw.fallbackBone, '대체 뼈', BONE_PATTERN);
  if (!boneNames.has(fallbackBone)) throw new Error(`대체 뼈 「${fallbackBone}」가 기본 뼈 목록에 없습니다`);
  const profile = {
    schema: PROFILE_SCHEMA,
    id,
    name,
    canvas,
    skeletonName: text(raw.skeletonName, '기본 뼈대 이름', BONE_PATTERN),
    fallbackBone,
    bones: normalizedBones.bones,
    boneLabels: normalizeBoneLabels(raw.boneLabels, normalizedBones.labels),
    bareLayers: normalizeBareLayers(raw.bareLayers, boneNames),
    zOrder: normalizeZOrder(raw.zOrder),
  };
  return deepFreeze(profile);
}

async function readBundledJson(target) {
  const url = target instanceof URL ? target : new URL(String(target), PROFILE_ROOT);
  if (url.protocol === 'file:' && typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(url, 'utf8'));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`프로필 파일을 읽지 못했습니다 (${response.status})`);
  return response.json();
}

function profileUrl(id) {
  const safeId = text(id, '프로필 id', ID_PATTERN);
  return new URL(`${safeId}.json`, PROFILE_ROOT);
}

export async function loadProfile(id, { readJson = readBundledJson } = {}) {
  return normalizeProfile(await readJson(profileUrl(id)));
}

export async function loadProfileWithFallback(id, options = {}) {
  const requestedId = String(id || PROJECT_C_PROFILE_ID);
  try {
    return { profile: await loadProfile(requestedId, options), requestedId, fallback: false, warning: '' };
  } catch (error) {
    if (requestedId === PROJECT_C_PROFILE_ID) throw error;
    const profile = await loadProfile(PROJECT_C_PROFILE_ID, options);
    return {
      profile,
      requestedId,
      fallback: true,
      warning: `프로필 「${requestedId}」을 쓸 수 없어 project-c로 돌아갔습니다: ${error.message}`,
    };
  }
}

export async function loadProfileIndex({ readJson = readBundledJson } = {}) {
  const raw = object(await readJson(new URL('index.json', PROFILE_ROOT)), '프로필 목록');
  if (raw.schema !== PROFILE_INDEX_SCHEMA || !Array.isArray(raw.profiles)) throw new Error('프로필 목록 파일이 올바르지 않습니다');
  const ids = new Set();
  return raw.profiles.map((entry, index) => {
    object(entry, `프로필 목록 #${index + 1}`);
    const id = text(entry.id, `프로필 목록 #${index + 1} id`, ID_PATTERN);
    if (ids.has(id)) throw new Error(`프로필 목록의 id 「${id}」가 겹칩니다`);
    ids.add(id);
    return deepFreeze({ id, name: text(entry.name, `프로필 「${id}」 이름`), file: text(entry.file, `프로필 「${id}」 파일`) });
  });
}

export function savedProfileId(value) {
  const candidate = value && typeof value === 'object' ? value.profileId : null;
  return typeof candidate === 'string' && ID_PATTERN.test(candidate) ? candidate : PROJECT_C_PROFILE_ID;
}

export function profileAutosaveKey(id) {
  return `dotfactory-web/profile/${text(id, '프로필 id', ID_PATTERN)}/autosave-1`;
}

export function copyLegacyAutosaveToProfile(storage, id = PROJECT_C_PROFILE_ID) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new Error('자동 보관 저장소가 올바르지 않습니다');
  const targetKey = profileAutosaveKey(id);
  const existing = storage.getItem(targetKey);
  if (existing != null) return { copied: false, reason: 'target-exists', sourceKey: LEGACY_AUTOSAVE_KEY, targetKey };
  const source = storage.getItem(LEGACY_AUTOSAVE_KEY);
  if (source == null) return { copied: false, reason: 'source-missing', sourceKey: LEGACY_AUTOSAVE_KEY, targetKey };
  storage.setItem(targetKey, source);
  if (storage.getItem(targetKey) !== source) throw new Error('자동 보관 자료 복사를 확인하지 못했습니다');
  return { copied: true, reason: '', sourceKey: LEGACY_AUTOSAVE_KEY, targetKey };
}

export const CURRENT_PROFILE = await loadProfile(PROJECT_C_PROFILE_ID);

export function currentCanvas() { return [...CURRENT_PROFILE.canvas]; }
