// 캐릭터 한 화면의 프리셋·애니메이션 조합과 호환 검사를 다루는 순수 모듈입니다.
import { parsePreset, checkPresetCompatibility } from './preset.js';
import { parseAnimation, checkSkeletonCompatibility, toAnimation } from './animation.js';
import { toSkeleton } from './skeleton.js';
import { toProject } from './rig.js';
import { flattenPresetLayers } from './preset-stack.js';
import {
  characterLayersWithLegacyFields, nextPresetLayerKey, normalizeCharacterPresetLayers,
} from './preset-layers.js';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function presetEntry(value, index) {
  const wrapped = value?.preset ? value : { preset: value };
  return {
    source: String(wrapped.source || 'file'),
    sourceIndex: Number.isInteger(wrapped.sourceIndex) ? wrapped.sourceIndex : index,
    name: String(wrapped.name || wrapped.fileName || ''),
    preset: parsePreset(wrapped.preset),
  };
}

function animationEntry(value, index) {
  const wrapped = value?.animation ? value : { animation: value };
  return {
    source: String(wrapped.source || 'file'),
    sourceIndex: Number.isInteger(wrapped.sourceIndex) ? wrapped.sourceIndex : index,
    name: String(wrapped.name || wrapped.fileName || ''),
    animation: parseAnimation(wrapped.animation),
  };
}

function withLegacyFields(presetLayers, animations, selectedMotion) {
  return {
    ...characterLayersWithLegacyFields(presetLayers),
    animations,
    selectedMotion,
  };
}

/** 옛 barePreset/loadedPresets와 새 presetLayers를 한 보통 레이어 목록으로 검증합니다. */
export function normalizeCharacterState(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const layers = normalizeCharacterPresetLayers(input);
  const animations = (Array.isArray(input.animations) ? input.animations : [])
    .map((entry, index) => animationEntry(entry, index));
  return withLegacyFields(layers, animations, String(input.selectedMotion || ''));
}

export function addCharacterPreset(state, preset, name = '') {
  const next = normalizeCharacterState(state);
  const parsed = parsePreset(preset);
  next.presetLayers.push({
    key: nextPresetLayerKey(next.presetLayers), visible: true, source: 'file',
    sourceIndex: next.presetLayers.length, name: String(name), preset: parsed,
  });
  return withLegacyFields(next.presetLayers, next.animations, next.selectedMotion);
}

export function removeCharacterPreset(state, index) {
  const next = normalizeCharacterState(state);
  if (index >= 0 && index < next.presetLayers.length) next.presetLayers.splice(index, 1);
  return withLegacyFields(next.presetLayers, next.animations, next.selectedMotion);
}

export function moveCharacterPreset(state, index, direction) {
  const next = normalizeCharacterState(state);
  const target = index + Math.sign(Number(direction) || 0);
  if (index < 0 || target < 0 || index >= next.presetLayers.length || target >= next.presetLayers.length) return next;
  [next.presetLayers[index], next.presetLayers[target]] = [next.presetLayers[target], next.presetLayers[index]];
  return withLegacyFields(next.presetLayers, next.animations, next.selectedMotion);
}

export function toggleCharacterPreset(state, index) {
  const next = normalizeCharacterState(state);
  if (index >= 0 && index < next.presetLayers.length) next.presetLayers[index].visible = next.presetLayers[index].visible === false;
  return withLegacyFields(next.presetLayers, next.animations, next.selectedMotion);
}

export function addCharacterAnimation(state, animation, name = '') {
  const next = normalizeCharacterState(state);
  next.animations.push({ source: 'file', sourceIndex: next.animations.length, name: String(name), animation: parseAnimation(animation) });
  return next;
}

export function removeCharacterAnimation(state, index) {
  const next = normalizeCharacterState(state);
  if (index >= 0 && index < next.animations.length) next.animations.splice(index, 1);
  return next;
}

export function activeCharacterPresets(state) {
  const safe = normalizeCharacterState(state);
  return safe.presetLayers.filter(entry => entry.visible !== false).map(entry => entry.preset);
}

export function flattenedCharacterLayers(state) {
  const safe = normalizeCharacterState(state);
  return flattenPresetLayers(safe.presetLayers);
}

export function characterMotionOptions(state) {
  const safe = normalizeCharacterState(state);
  return safe.animations.flatMap((entry, animationIndex) => Object.keys(entry.animation.motions).map(motionName => ({
    key: `${animationIndex}:${motionName}`,
    animationIndex,
    motionName,
    motion: entry.animation.motions[motionName],
    label: `${motionName} · ${entry.name || entry.animation.skeleton}`,
  })));
}

export function inspectCharacter(state, basis) {
  const safe = normalizeCharacterState(state);
  const bones = Array.isArray(basis?.bones) ? basis.bones : [];
  const skeletonName = String(basis?.skeletonName || 'character_skeleton');
  const presetResults = activeCharacterPresets(safe).map(preset => ({ preset, ...checkPresetCompatibility(preset, bones) }));
  const animationResults = safe.animations.map(entry => ({
    entry,
    ...checkSkeletonCompatibility(entry.animation, bones, skeletonName),
  }));
  const missingBones = [...new Set([
    ...presetResults.flatMap(result => result.missingBones),
    ...animationResults.flatMap(result => result.allMissingBones),
  ])];
  const motionNames = safe.animations.flatMap(entry => Object.keys(entry.animation.motions));
  const duplicateMotionNames = [...new Set(motionNames.filter((name, index) => motionNames.indexOf(name) !== index))];
  const nameWarnings = animationResults
    .filter(result => result.skeletonNameMatches === false)
    .map(result => result.warnings.at(-1));
  return {
    compatible: missingBones.length === 0 && duplicateMotionNames.length === 0,
    missingBones,
    duplicateMotionNames,
    nameWarnings,
    presetResults,
    animationResults,
  };
}

export function mergedCharacterMotions(state) {
  const safe = normalizeCharacterState(state);
  const motions = {};
  for (const entry of safe.animations) {
    for (const [name, motion] of Object.entries(entry.animation.motions)) {
      if (motions[name]) throw new Error(`움직임 이름 「${name}」이 둘 이상이라 ZIP에서 하나로 합칠 수 없습니다`);
      motions[name] = clone(motion);
    }
  }
  return motions;
}

function requireCompatible(state, basis) {
  const result = inspectCharacter(state, basis);
  if (result.missingBones.length) throw new Error(`현재 뼈대에 없는 뼈: ${result.missingBones.join(', ')}`);
  if (result.duplicateMotionNames.length) throw new Error(`겹친 움직임 이름: ${result.duplicateMotionNames.join(', ')}`);
  return result;
}

export function characterBundleInput(state, basis) {
  requireCompatible(state, basis);
  const motions = mergedCharacterMotions(state);
  const bones = Array.isArray(basis?.bones) ? basis.bones : [];
  return {
    skeleton: toSkeleton({ canvas: basis?.canvas || [72, 64], bones }),
    animation: Object.keys(motions).length ? toAnimation({
      skeleton: basis?.skeletonName || 'character_skeleton',
      bones: bones.map(bone => bone.name),
      motions,
    }) : null,
    presets: activeCharacterPresets(state),
    canvas: basis?.canvas || [72, 64],
  };
}

export function characterGodotProject(state, basis) {
  const safe = normalizeCharacterState(state);
  requireCompatible(safe, basis);
  const pieces = flattenPresetLayers(safe.presetLayers).map(({ layer, presetKind, presetId }, drawIndex) => ({
    slot: layer.slot || presetKind,
    item: presetId,
    piece: layer.piece || layer.id,
    name: layer.id,
    bone: layer.bone,
    zIndex: drawIndex,
    visible: true,
    png: layer.image,
  }));
  return toProject({
    canvas: basis?.canvas || [72, 64],
    bones: basis?.bones,
    restPose: basis?.restPose,
    pieces,
    animations: mergedCharacterMotions(safe),
  });
}
