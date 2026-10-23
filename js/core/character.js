// 캐릭터 한 화면의 프리셋·애니메이션 조합과 호환 검사를 다루는 순수 모듈입니다.
import { parsePreset, checkPresetCompatibility } from './preset.js';
import { parseAnimation, checkSkeletonCompatibility, toAnimation } from './animation.js';
import { toSkeleton } from './skeleton.js';
import { toProject } from './rig.js';
import { flattenPresetStack } from './preset-stack.js';

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

/** version 2의 character 자리 모양을 바꾸지 않고 내용만 검증합니다. */
export function normalizeCharacterState(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    barePreset: input.barePreset ? parsePreset(input.barePreset) : null,
    loadedPresets: (Array.isArray(input.loadedPresets) ? input.loadedPresets : [])
      .map((entry, index) => presetEntry(entry, index)),
    animations: (Array.isArray(input.animations) ? input.animations : [])
      .map((entry, index) => animationEntry(entry, index)),
    selectedMotion: String(input.selectedMotion || ''),
  };
}

export function addCharacterPreset(state, preset, name = '') {
  const next = normalizeCharacterState(state);
  const parsed = parsePreset(preset);
  if (parsed.kind === 'bare') {
    next.barePreset = parsed;
  } else {
    next.loadedPresets.push({ source: 'file', sourceIndex: next.loadedPresets.length, name: String(name), preset: parsed });
  }
  return next;
}

export function removeCharacterPreset(state, index) {
  const next = normalizeCharacterState(state);
  if (index >= 0 && index < next.loadedPresets.length) next.loadedPresets.splice(index, 1);
  return next;
}

export function moveCharacterPreset(state, index, direction) {
  const next = normalizeCharacterState(state);
  const target = index + Math.sign(Number(direction) || 0);
  if (index < 0 || target < 0 || index >= next.loadedPresets.length || target >= next.loadedPresets.length) return next;
  [next.loadedPresets[index], next.loadedPresets[target]] = [next.loadedPresets[target], next.loadedPresets[index]];
  return next;
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
  return [safe.barePreset, ...safe.loadedPresets.map(entry => entry.preset)].filter(Boolean);
}

export function flattenedCharacterLayers(state) {
  const safe = normalizeCharacterState(state);
  return flattenPresetStack(safe.barePreset, safe.loadedPresets.map(entry => entry.preset));
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
  const overlayPresets = safe.loadedPresets.map(entry => entry.preset || entry);
  const pieces = flattenPresetStack(safe.barePreset, overlayPresets).map(({ layer, presetKind, presetId }) => ({
    slot: layer.slot || presetKind,
    item: presetId,
    piece: layer.piece || layer.id,
    name: layer.id,
    bone: layer.bone,
    zIndex: layer.zIndex,
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
