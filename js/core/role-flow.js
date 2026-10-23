// 옛 통합 작업 자료를 이미지·뼈대·캐릭터 역할별 상태로 나누는 순수 변환 함수입니다.
// 반환 전에 원본과 결과를 대조하므로 호출자는 report.verified가 true인 값만 저장하면 됩니다.

import { parseProject, toProject } from './rig.js';
import { migrateRig1 } from './rig-migrate.js';
import { parsePreset } from './preset.js';
import { parseSkeleton, toSkeleton } from './skeleton.js';
import { copyRigPiecesToSliceLibrary } from './slice-library.js';

export const ROLE_STATE_VERSION = 2;

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalJson(value[key]);
    return result;
  }
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function requireMatch(condition, message) {
  if (!condition) throw new Error(`옛 자료 변환을 확인할 수 없습니다: ${message}`);
}

function pieceSignature(piece) {
  return JSON.stringify([
    piece.bone,
    Number(piece.zIndex),
    piece.slot || '',
    piece.piece || '',
    piece.png || piece.image || '',
  ]);
}

function verifyRig1Migration(source, value, files) {
  requireMatch(sameJson(value.slice.canvas, source.canvas), '자르기 그림판 크기가 달라졌습니다');
  requireMatch(value.slice.basePng === source.basePng, '원본 그림이 달라졌습니다');
  requireMatch(value.slice.pieces.length === source.pieces.length, '자르기 조각 수가 달라졌습니다');
  requireMatch(value.rig.attachedPieces.length === source.pieces.length, '붙인 그림 수가 달라졌습니다');
  requireMatch(sameJson(value.rig.restPose, source.restPose), '초기 자세가 달라졌습니다');
  requireMatch(sameJson(value.rig.animations, source.animations), '움직임 자료가 달라졌습니다');
  requireMatch(sameJson(files.skeleton.bones, source.bones), '뼈 자료가 달라졌습니다');

  for (let index = 0; index < source.pieces.length; index++) {
    const sourcePiece = source.pieces[index];
    const slicePiece = value.slice.pieces[index];
    const attachedPiece = value.rig.attachedPieces[index];
    requireMatch(slicePiece.png === sourcePiece.png, `${index + 1}번째 자르기 PNG가 달라졌습니다`);
    requireMatch(pieceSignature(attachedPiece) === pieceSignature(sourcePiece), `${index + 1}번째 붙인 그림이 달라졌습니다`);
  }

  const motionNames = Object.keys(source.animations).sort();
  requireMatch(sameJson(Object.keys(files.animations).sort(), motionNames), '애니메이션 이름 목록이 달라졌습니다');
  for (const name of motionNames) {
    requireMatch(sameJson(files.animations[name]?.motions?.[name], source.animations[name]), `움직임 「${name}」이 달라졌습니다`);
  }

  const sourcePieces = source.pieces.map(pieceSignature).sort();
  const presetPieces = files.presets.flatMap(preset => preset.layers).map(pieceSignature).sort();
  requireMatch(sameJson(presetPieces, sourcePieces), '프리셋 그림의 뼈·층·PNG가 달라졌습니다');

  return {
    verified: true,
    bones: source.bones.length,
    pieces: source.pieces.length,
    motions: motionNames.length,
    presets: files.presets.length,
    baseImage: source.basePng != null,
  };
}

/**
 * @param {object} project dotfactory-web/rig-1 객체
 * @returns {{ value: { slice: object, rig: object }, files: { skeleton: object, animations: Record<string, object>, presets: object[] }, report: object }}
 */
export function migrateRig1ToRoleState(project) {
  const source = parseProject(project);
  const files = migrateRig1(source);
  const value = {
    slice: {
      canvas: [...source.canvas],
      basePng: source.basePng,
      item: source.item,
      pieces: copyRigPiecesToSliceLibrary(source.pieces, source.canvas),
    },
    rig: {
      canvas: [...source.canvas],
      item: source.item,
      slot: source.slot,
      skeletonName: 'character_skeleton',
      skeleton: cloneJson(files.skeleton),
      restPose: cloneJson(source.restPose),
      attachedPieces: cloneJson(source.pieces),
      presetLayers: cloneJson(source.presetLayers || []),
      animations: cloneJson(source.animations),
      presetDrafts: cloneJson(files.presets),
    },
  };
  const report = verifyRig1Migration(source, value, files);
  return { value, files: cloneJson(files), report };
}

function readLegacyPresetState(value) {
  if (value == null) return { barePreset: null, loadedPresets: [] };
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('옛 프리셋 자동 보관 자료가 깨졌습니다');
  const barePreset = value.barePreset ? parsePreset(value.barePreset) : null;
  const loadedPresets = [];
  if (value.currentPreset) {
    loadedPresets.push({ source: 'currentPreset', preset: parsePreset(value.currentPreset) });
  }
  if (value.overlayPresets != null && !Array.isArray(value.overlayPresets)) {
    throw new Error('옛 겹친 프리셋 목록이 깨졌습니다');
  }
  for (let index = 0; index < (value.overlayPresets || []).length; index++) {
    loadedPresets.push({ source: 'overlayPresets', sourceIndex: index, preset: parsePreset(value.overlayPresets[index]) });
  }
  return { barePreset, loadedPresets };
}

function verifyLegacyAutosave(source, value, rigResult, presetState) {
  requireMatch(value.version === ROLE_STATE_VERSION, '새 자동 보관 버전이 올바르지 않습니다');
  requireMatch(sameJson(value.paint, source.paint), '편집 작업이 달라졌습니다');
  requireMatch(sameJson(value.assemble, source.assemble), '합치기 작업이 달라졌습니다');
  if (source.rig) {
    requireMatch(rigResult?.report?.verified === true, '뼈 애니메이션 작업 검증이 끝나지 않았습니다');
    requireMatch(value.slice.basePng === parseProject(source.rig).basePng, '원본 그림이 달라졌습니다');
  } else {
    requireMatch(value.slice == null && value.rig == null, '없던 뼈 애니메이션 작업이 생겼습니다');
  }
  requireMatch(sameJson(value.character.barePreset, presetState.barePreset), '맨몸 프리셋이 달라졌습니다');
  requireMatch(sameJson(value.character.loadedPresets, presetState.loadedPresets), '현재·겹친 프리셋이 달라졌습니다');
  return {
    verified: true,
    rig: rigResult ? cloneJson(rigResult.report) : null,
    barePresets: presetState.barePreset ? 1 : 0,
    loadedPresets: presetState.loadedPresets.length,
  };
}

/**
 * @param {object} saved version 필드가 없는 dotfactory-web/autosave-1 객체
 * @returns {{ value: object, report: object }} report.verified가 true일 때만 value를 저장합니다.
 */
export function migrateLegacyAutosave(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('옛 자동 보관 자료가 올바르지 않습니다');
  if (saved.version != null) throw new Error('version이 없는 옛 자동 보관 자료만 변환할 수 있습니다');

  const rigResult = saved.rig ? migrateRig1ToRoleState(saved.rig) : null;
  const presetState = readLegacyPresetState(saved.preset);
  const known = new Set(['paint', 'assemble', 'rig', 'preset']);
  const extra = {};
  for (const [key, value] of Object.entries(saved)) {
    if (!known.has(key)) extra[key] = cloneJson(value);
  }

  const value = {
    version: ROLE_STATE_VERSION,
    paint: cloneJson(saved.paint),
    assemble: cloneJson(saved.assemble),
    slice: rigResult ? cloneJson(rigResult.value.slice) : null,
    rig: rigResult ? cloneJson(rigResult.value.rig) : null,
    character: {
      barePreset: cloneJson(presetState.barePreset),
      loadedPresets: cloneJson(presetState.loadedPresets),
      presetLayers: [
        ...(presetState.barePreset ? [{ key: 'character_layer_0', visible: true, source: 'barePreset', preset: cloneJson(presetState.barePreset) }] : []),
        ...presetState.loadedPresets.map((entry, index) => ({ ...cloneJson(entry), key: `character_layer_${index + (presetState.barePreset ? 1 : 0)}`, visible: true })),
      ],
      animations: [],
      selectedMotion: '',
    },
    legacyExtra: extra,
  };
  const report = verifyLegacyAutosave(saved, value, rigResult, presetState);
  return { value, report };
}

/** 현재 뼈대 화면의 rig-1 메모리 자료를 version 2의 rig 역할 상태로 바꿉니다. */
export function projectToRoleRig(project, preset = null, skeletonName = 'character_skeleton') {
  const source = parseProject(project);
  const rig = migrateRig1ToRoleState(source).value.rig;
  rig.skeletonName = String(skeletonName || 'character_skeleton');
  rig.presetLayers = cloneJson(source.presetLayers || []);
  if (preset) rig.presetDraft = cloneJson(parsePreset(preset));
  return rig;
}

/** 현재 뼈대 화면 상태를 missing layer.bone까지 바꾸지 않고 version 2 역할 상태로 보관합니다. */
export function workingRigToRoleState({
  canvas = [72, 64], item = '캐릭터', slot = 'bare', skeletonName = 'character_skeleton',
  bones = [], restPose = null, attachedPieces = [], animations = {}, preset = null, presetLayers = [],
} = {}) {
  const safePreset = preset ? parsePreset(preset) : null;
  const storedPieces = (Array.isArray(attachedPieces) ? attachedPieces : []).map(piece => {
    const { image, ...stored } = piece || {};
    return cloneJson(stored);
  });
  return {
    canvas: [...canvas],
    item: String(item || '캐릭터'),
    slot: String(slot || 'bare'),
    skeletonName: String(skeletonName || 'character_skeleton'),
    skeleton: toSkeleton({ canvas, bones }),
    restPose: cloneJson(restPose),
    attachedPieces: storedPieces,
    presetLayers: cloneJson(presetLayers || []),
    animations: cloneJson(animations),
    presetDrafts: safePreset ? [cloneJson(safePreset)] : [],
    ...(safePreset ? { presetDraft: cloneJson(safePreset) } : {}),
  };
}

/** version 2 역할 상태를 화면 작업으로 복사합니다. 없는 부착 뼈도 원문 그대로 둡니다. */
export function roleRigToWorkingState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('뼈대 자동 보관 자료가 올바르지 않습니다');
  const skeleton = parseSkeleton(value.skeleton);
  return {
    canvas: [...(value.canvas || skeleton.canvas)],
    item: value.item || '캐릭터',
    slot: value.slot || 'bare',
    pieces: cloneJson(value.attachedPieces || []),
    bones: cloneJson(skeleton.bones),
    restPose: cloneJson(value.restPose || null),
    animations: cloneJson(value.animations || {}),
    presetLayers: cloneJson(value.presetLayers || []),
  };
}

/** version 2의 rig 역할 상태를 현재 뼈대 화면이 읽는 rig-1 메모리 자료로 바꿉니다. */
export function roleRigToProject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('뼈대 자동 보관 자료가 올바르지 않습니다');
  const skeleton = parseSkeleton(value.skeleton);
  return toProject({
    canvas: value.canvas || skeleton.canvas,
    item: value.item || '캐릭터',
    slot: value.slot || 'bare',
    basePng: null,
    pieces: value.attachedPieces || [],
    bones: skeleton.bones,
    restPose: value.restPose || null,
    animations: value.animations || {},
    presetLayers: value.presetLayers || [],
  });
}

/** version 2 캐릭터 상태를 2판의 기존 프리셋 화면 자료로 바꿉니다. */
export function characterToPresetSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { currentPreset: null, barePreset: null, overlayPresets: [] };
  }
  const barePreset = value.barePreset ? parsePreset(value.barePreset) : null;
  const loaded = Array.isArray(value.loadedPresets) ? value.loadedPresets : [];
  const currentEntry = loaded.find(entry => entry?.source === 'currentPreset');
  const currentPreset = currentEntry?.preset ? parsePreset(currentEntry.preset) : barePreset;
  const overlayPresets = loaded
    .filter(entry => entry?.source !== 'currentPreset' && entry?.preset)
    .map(entry => parsePreset(entry.preset));
  return { currentPreset, barePreset, overlayPresets };
}

/** 2판의 기존 프리셋 화면 자료를 version 2 캐릭터 상태로 바꿉니다. */
export function presetSnapshotToCharacter(snapshot, previous = {}) {
  const state = readLegacyPresetState(snapshot);
  return {
    barePreset: cloneJson(state.barePreset),
    loadedPresets: cloneJson(state.loadedPresets),
    animations: cloneJson(previous.animations || []),
    selectedMotion: String(previous.selectedMotion || ''),
  };
}
