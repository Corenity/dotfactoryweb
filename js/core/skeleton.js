// dotfactory-web/skeleton-1 순수 모듈 — 뼈 구조, 기본 자세, 캔버스 크기 및 뼈대 적용 정합성을 다룹니다.
import { DEFAULT_BONES, defaultBoneFor, isValidBoneName, createRestPose } from './rig.js';

export const SCHEMA = 'dotfactory-web/skeleton-1';
export const DEFAULT_CANVAS = Object.freeze([72, 64]);

function finiteNumber(val, label, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const num = Number(val);
  if (!Number.isFinite(num)) throw new Error(`${label} 값이 올바르지 않습니다`);
  if (integer && !Number.isInteger(num)) throw new Error(`${label} 값은 정수여야 합니다`);
  if (num < min || num > max) throw new Error(`${label} 값(${num})이 허용 범위(${min}~${max})를 벗어났습니다`);
  return num;
}

export function normalizeCanvas(value) {
  if (value == null) return [...DEFAULT_CANVAS];
  if (!Array.isArray(value) || value.length !== 2) throw new Error('캔버스 크기는 [가로, 세로] 형태여야 합니다');
  const w = finiteNumber(value[0], '캔버스 가로', { min: 1, max: 4096, integer: true });
  const h = finiteNumber(value[1], '캔버스 세로', { min: 1, max: 4096, integer: true });
  return [w, h];
}

export function normalizeSkeletonBones(list) {
  const bones = list == null ? DEFAULT_BONES : list;
  if (!Array.isArray(bones) || bones.length === 0) throw new Error('뼈 목록이 비어 있거나 올바르지 않습니다');

  const names = new Set();
  const byName = new Map();
  const result = [];

  for (let i = 0; i < bones.length; i++) {
    const raw = bones[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`뼈 #${i + 1} 자료가 올바르지 않습니다`);
    const name = String(raw.name || '').trim();
    if (!name) throw new Error(`뼈 #${i + 1} 이름이 비었습니다`);
    if (!isValidBoneName(name)) {
      throw new Error(`뼈 이름 「${name}」이 올바르지 않습니다(영문·숫자·_ 만 쓸 수 있습니다)`);
    }
    if (names.has(name)) throw new Error(`뼈 이름 「${name}」이 겹칩니다`);
    names.add(name);

    const parent = raw.parent == null || raw.parent === '' ? null : String(raw.parent).trim();
    if (parent === name) throw new Error(`뼈 「${name}」은 자기 자신을 부모로 둘 수 없습니다`);

    const posRaw = raw.pos;
    if (!Array.isArray(posRaw) || posRaw.length !== 2) throw new Error(`뼈 「${name}」의 위치는 [X, Y] 형태여야 합니다`);
    const posX = finiteNumber(posRaw[0], `뼈 「${name}」 X 좌표`);
    const posY = finiteNumber(posRaw[1], `뼈 「${name}」 Y 좌표`);

    const angle = raw.angle != null ? finiteNumber(raw.angle, `뼈 「${name}」 각도`) : 90;
    const length = raw.length != null ? finiteNumber(raw.length, `뼈 「${name}」 길이`, { min: 0, max: 1000 }) : 4;

    const boneObj = {
      name,
      parent,
      pos: [Math.round(posX), Math.round(posY)],
      angle,
      length,
    };
    byName.set(name, boneObj);
    result.push(boneObj);
  }

  // 부모 유효성 및 순환 참조 검사
  for (const bone of result) {
    if (bone.parent != null) {
      if (!byName.has(bone.parent)) throw new Error(`뼈 「${bone.name}」의 부모 뼈 「${bone.parent}」가 없습니다`);
      let cur = byName.get(bone.parent);
      let depth = 0;
      while (cur) {
        if (cur.name === bone.name) throw new Error(`뼈 「${bone.name}」에 순환 부모 관계가 있습니다`);
        depth++;
        if (depth > result.length) throw new Error(`뼈 「${bone.name}」에 순환 부모 관계가 있습니다`);
        cur = cur.parent != null ? byName.get(cur.parent) : null;
      }
    }
  }

  return result;
}

export function toSkeleton({ canvas = [72, 64], bones = null } = {}) {
  return {
    schema: SCHEMA,
    canvas: normalizeCanvas(canvas),
    bones: normalizeSkeletonBones(bones),
  };
}

export function parseSkeleton(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('뼈대 파일 자료가 깨졌습니다');
  if (json.schema !== SCHEMA) throw new Error('도트 공장 웹 뼈대 파일이 아닙니다');
  return toSkeleton({
    canvas: json.canvas,
    bones: json.bones,
  });
}

export function serializeSkeleton(skeleton, space = 2) {
  return JSON.stringify(toSkeleton(skeleton), null, space);
}

export function deserializeSkeleton(text) {
  if (typeof text !== 'string') throw new Error('뼈대 텍스트 자료가 올바르지 않습니다');
  return parseSkeleton(JSON.parse(text));
}

/**
 * 새로 불러온 뼈대를 현재 작업(조각, 움직임, 초기값)에 맞추어 정합성을 보정합니다.
 * - 기본값에서는 없는 뼈에 붙은 조각을 살아 있는 뼈로 옮깁니다. preserveMissingPieces면 원문을 보존합니다.
 * - 움직임에서 없는 뼈 트랙은 제외합니다.
 * - restPose 는 새로 연 뼈 파일의 위치와 각도를 기준으로 새 초기값을 만듭니다.
 * @returns {{ bones: object[], pieces: object[], animations: object, restPose: object, selectedBone: string|null, movedPiecesCount: number, droppedKeyCount: number }}
 */
export function applySkeletonToRig({
  skeleton,
  pieces = [],
  animations = null,
  selectedBone = null,
  preserveMissingPieces = false,
} = {}) {
  const safeSkeleton = skeleton && skeleton.schema === SCHEMA ? skeleton : parseSkeleton(skeleton);
  const newBones = safeSkeleton.bones;
  const newBoneNames = new Set(newBones.map(b => b.name));

  const fallbackSelected = newBoneNames.has(selectedBone) ? selectedBone : (newBones[0]?.name || null);

  let movedPiecesCount = 0;
  const newPieces = (Array.isArray(pieces) ? pieces : []).map(p => {
    if (!p) return p;
    if (!newBoneNames.has(p.bone)) {
      if (preserveMissingPieces) return { ...p };
      movedPiecesCount++;
      const targetBone = defaultBoneFor(p.slot, p.piece || p.name, newBones, fallbackSelected);
      return { ...p, bone: targetBone };
    }
    return { ...p };
  });

  let droppedKeyCount = 0;
  const newAnimations = {};
  if (animations && typeof animations === 'object') {
    for (const [mName, motion] of Object.entries(animations)) {
      if (!motion || typeof motion !== 'object') continue;
      const tracks = {};
      for (const [bName, track] of Object.entries(motion.tracks || {})) {
        if (newBoneNames.has(bName)) {
          tracks[bName] = {
            ...track,
            times: [...track.times],
            positions: track.positions.map(pos => [...pos]),
            rotations: [...track.rotations],
          };
        } else {
          droppedKeyCount += (track.times || []).length;
        }
      }
      newAnimations[mName] = { ...motion, tracks };
    }
  }

  // 연 파일의 위치와 각도가 새로운 초기값이 됩니다.
  const newRestPose = createRestPose(newBones);

  return {
    bones: newBones,
    pieces: newPieces,
    animations: newAnimations,
    restPose: newRestPose,
    selectedBone: fallbackSelected,
    movedPiecesCount,
    droppedKeyCount,
  };
}
