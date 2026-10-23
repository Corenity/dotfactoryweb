// 뼈 애니메이션 작업 파일 — 조각 목록 · 뼈대 트리 · 동작 키프레임을 저장하고 복원합니다.
// 화면(DOM)을 쓰지 않는 순수 모듈로 Node 시험이 그대로 돌립니다.
import { boneWorldTransforms, invert, transformPoint } from './rig-render.js';

export const SCHEMA = 'dotfactory-web/rig-1';
export const DEFAULT_MOTION_NAME = 'walk';

/** 캐릭터가 보는 방향을 기준으로 L·R을 붙인 기본 뼈 나무입니다. */
export const DEFAULT_BONES = Object.freeze([
  { name: 'Torso', parent: null, pos: [37, 46], angle: 90, length: 4 },
  { name: 'Head', parent: 'Torso', pos: [0, -9], angle: 90, length: 4 },
  { name: 'ArmL', parent: 'Torso', pos: [4, -8], angle: 90, length: 4 },
  { name: 'ArmR', parent: 'Torso', pos: [-3, -8], angle: 90, length: 4 },
  { name: 'LegL', parent: null, pos: [40, 46], angle: 90, length: 4 },
  { name: 'LegR', parent: null, pos: [34, 47], angle: 90, length: 4 },
]);

const BONE_LABELS = Object.freeze({
  ArmL: 'ArmL · 왼팔(화면 오른쪽)', ArmR: 'ArmR · 오른팔(화면 왼쪽)',
  LegL: 'LegL · 왼다리(화면 오른쪽)', LegR: 'LegR · 오른다리(화면 왼쪽)',
  FootL: 'FootL · 왼발(화면 오른쪽)', FootR: 'FootR · 오른발(화면 왼쪽)',
});

export function boneLabel(name) {
  return BONE_LABELS[name] || name;
}

/** 조각의 기본 그리기 순서(z_index) 표입니다. character_rig.tscn 과 같습니다. */
export const DEFAULT_Z_INDEX = Object.freeze({
  bare_torso: 7, outfit_body: 10,
  face_face: 0, earring_earring: 1, expression_cheek: 2, expression_nose: 3, expression_fx: 4, hair_hair: 5,
  bare_leg_l: 6, bare_leg_r: 6, bare_foot_l: 7, bare_foot_r: 7, outfit_leg_l: 8, outfit_leg_r: 8, shoes_shoe_l: 9, shoes_shoe_r: 9,
  bare_arm_l: 11, bare_arm_r: 11, outfit_arm_l: 12, outfit_arm_r: 12,
  expression_mouth: 13, expression_brows: 14, expression_eyes: 15, sweat_sweat: 16, hairpin_hairpin: 17,
});

export function cloneDefaultBones() {
  return DEFAULT_BONES.map(cloneBone);
}

export function defaultZIndex(slot = '', piece = '') {
  const s = String(slot || ''), p = String(piece || '');
  const key = `${s}_${p}`;
  if (key in DEFAULT_Z_INDEX) return DEFAULT_Z_INDEX[key];
  if (s === 'face') return 0;
  if (s === 'outfit') return 10;
  return 5;
}

export function defaultBoneFor(slot = '', piece = '', bones = null, selectedBone = null) {
  if (slot !== 'extra') {
    const target = slotDefaultBone(piece);
    if (!bones || !Array.isArray(bones) || bones.some(b => b.name === target)) return target;
  }
  if (slot === 'extra' || bones) {
    if (selectedBone) return selectedBone;
    if (bones && Array.isArray(bones)) {
      if (bones.some(b => b.name === 'Torso')) return 'Torso';
      return bones[0]?.name || 'Torso';
    }
    return 'Torso';
  }
  return 'Torso';
}

function slotDefaultBone(piece = '') {
  const p = String(piece || '');
  if (p === 'torso' || p === 'body') return 'Torso';
  if (p.startsWith('arm_l')) return 'ArmL';
  if (p.startsWith('arm_r')) return 'ArmR';
  if (p.startsWith('leg_l') || p.startsWith('foot_l') || p.startsWith('shoe_l')) return 'LegL';
  if (p.startsWith('leg_r') || p.startsWith('foot_r') || p.startsWith('shoe_r')) return 'LegR';
  return 'Head';
}

export function isValidBoneName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  return /^[A-Za-z0-9_]+$/.test(trimmed);
}

export function addBone(bones, { name, parent = null } = {}) {
  const safeBones = normalizeBones(bones);
  if (!name || !isValidBoneName(name)) {
    throw new Error('뼈 이름은 영문, 숫자, _ 만 쓸 수 있습니다');
  }
  const cleanName = name.trim();
  if (safeBones.some(b => b.name === cleanName)) {
    throw new Error(`뼈 이름 「${cleanName}」이 이미 있습니다`);
  }
  const cleanParent = parent ? String(parent).trim() : null;
  if (cleanParent && !safeBones.some(b => b.name === cleanParent)) {
    throw new Error(`부모 뼈 「${cleanParent}」를 찾을 수 없습니다`);
  }
  const newBone = {
    name: cleanName,
    parent: cleanParent,
    pos: [0, -4],
    angle: 90,
    length: 4,
  };
  return [...safeBones, newBone];
}

export function removeBone({ bones, pieces = [], animations = null, restPose = null } = {}, boneName = '') {
  const safeBones = normalizeBones(bones);
  if (safeBones.length <= 1) {
    throw new Error('마지막 뼈는 지울 수 없습니다');
  }
  const target = safeBones.find(b => b.name === boneName);
  if (!target) {
    throw new Error(`뼈 「${boneName}」를 찾을 수 없습니다`);
  }

  const worlds = boneWorldTransforms(safeBones);
  const parentName = target.parent;
  const parentWorld = parentName ? worlds.get(parentName) : null;
  const parentInv = parentWorld ? invert(parentWorld.matrix) : null;

  const reparentedChildren = [];
  const newBones = [];
  for (const b of safeBones) {
    if (b.name === boneName) continue;
    if (b.parent === boneName) {
      reparentedChildren.push(b.name);
      const childWorld = worlds.get(b.name);
      let newPos, newAngle;
      if (parentWorld) {
        const p = transformPoint(parentInv, childWorld.x, childWorld.y);
        newPos = [Math.round(p[0]), Math.round(p[1])];
        newAngle = Math.round((childWorld.angle - parentWorld.angle + 90) * 10000) / 10000;
      } else {
        newPos = [Math.round(childWorld.x), Math.round(childWorld.y)];
        newAngle = Math.round((childWorld.angle + 90) * 10000) / 10000;
      }
      newBones.push({
        name: b.name,
        parent: parentName,
        pos: newPos,
        angle: newAngle,
        length: b.length,
      });
    } else {
      newBones.push({
        name: b.name,
        parent: b.parent,
        pos: [...b.pos],
        angle: b.angle,
        length: b.length,
      });
    }
  }

  const fallbackBone = parentName || (newBones.find(b => !b.parent)?.name ?? newBones[0].name);
  const newPieces = pieces.map(p => {
    if (p.bone === boneName) {
      return { ...p, bone: fallbackBone };
    }
    return { ...p };
  });

  const restAppliedBones = applyRestPose(safeBones, restPose).bones;
  const restWorlds = boneWorldTransforms(restAppliedBones);
  const restParentWorld = parentName ? restWorlds.get(parentName) : null;
  const restParentInv = restParentWorld ? invert(restParentWorld.matrix) : null;

  const baseRest = (restPose && typeof restPose === 'object') ? restPose : defaultRestPose();
  const newRestPose = {};
  for (const [k, v] of Object.entries(baseRest)) {
    if (k !== boneName) {
      newRestPose[k] = { ...v, pos: [...v.pos] };
    }
  }
  for (const childName of reparentedChildren) {
    const childRestWorld = restWorlds.get(childName);
    if (!childRestWorld) continue;
    let restPos, restAngle;
    if (restParentWorld) {
      const p = transformPoint(restParentInv, childRestWorld.x, childRestWorld.y);
      restPos = [Math.round(p[0]), Math.round(p[1])];
      restAngle = Math.round((childRestWorld.angle - restParentWorld.angle + 90) * 10000) / 10000;
    } else {
      restPos = [Math.round(childRestWorld.x), Math.round(childRestWorld.y)];
      restAngle = Math.round((childRestWorld.angle + 90) * 10000) / 10000;
    }
    newRestPose[childName] = { pos: restPos, angle: restAngle };
  }

  let newAnimations = null;
  if (animations && typeof animations === 'object') {
    newAnimations = {};
    for (const [motionName, motion] of Object.entries(animations)) {
      const newTracks = {};
      if (motion.tracks) {
        for (const [k, v] of Object.entries(motion.tracks)) {
          if (k !== boneName) {
            newTracks[k] = { ...v };
          }
        }
      }
      newAnimations[motionName] = {
        ...motion,
        tracks: newTracks,
      };
    }
  }

  return {
    bones: newBones,
    pieces: newPieces,
    animations: newAnimations,
    restPose: newRestPose,
    reparentedChildren,
  };
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} 값이 올바르지 않습니다`);
  return number;
}

function cloneBone(bone) {
  return { name: bone.name, parent: bone.parent, pos: [...bone.pos], angle: bone.angle, length: bone.length };
}

export function defaultAnimations() {
  return { [DEFAULT_MOTION_NAME]: { length: 0.8, loop: true, step: 0.2, tracks: {} } };
}

function integer(value, label) {
  const number = finite(value, label);
  if (!Number.isInteger(number)) throw new Error(`${label} 값은 정수여야 합니다`);
  return number;
}

export function defaultRestPose() {
  const pose = {};
  for (const bone of DEFAULT_BONES) {
    pose[bone.name] = { pos: [...bone.pos], angle: bone.angle };
  }
  return pose;
}

export function createRestPose(bones) {
  const pose = {};
  for (const bone of normalizeBones(bones)) {
    pose[bone.name] = { pos: [...bone.pos], angle: bone.angle };
  }
  return pose;
}

export function normalizeRestPose(value) {
  if (value == null) return defaultRestPose();
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('초기값(restPose) 자료가 깨졌습니다');
  const result = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`뼈 「${name}」의 초기값이 깨졌습니다`);
    if (!Array.isArray(entry.pos) || entry.pos.length !== 2) throw new Error(`뼈 「${name}」의 초기값 위치가 깨졌습니다`);
    result[name] = {
      pos: [integer(entry.pos[0], `뼈 「${name}」 초기값 X`), integer(entry.pos[1], `뼈 「${name}」 초기값 Y`)],
      angle: finite(entry.angle ?? 90, `뼈 「${name}」 초기값 각도`),
    };
  }
  if (!Object.keys(result).length) return defaultRestPose();
  return result;
}

export function applyRestPose(bones, restPose) {
  if (!Array.isArray(bones)) return { bones: [], changed: false };
  const safePose = restPose || defaultRestPose();
  let changed = false;
  const result = bones.map(bone => {
    const entry = safePose[bone.name];
    if (!entry) return { ...bone, pos: [...bone.pos] };
    const samePos = bone.pos[0] === entry.pos[0] && bone.pos[1] === entry.pos[1];
    const sameAngle = bone.angle === entry.angle;
    if (samePos && sameAngle) {
      return { ...bone, pos: [...bone.pos] };
    }
    changed = true;
    return {
      ...bone,
      pos: [entry.pos[0], entry.pos[1]],
      angle: entry.angle,
    };
  });
  return { bones: result, changed };
}

function normalizeTrack(value, motionName, boneName, length, step) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`움직임 「${motionName}」의 뼈 「${boneName}」 키가 깨졌습니다`);
  const times = value.times, positions = value.positions, rotations = value.rotations;
  if (!Array.isArray(times) || !Array.isArray(positions) || !Array.isArray(rotations) || times.length !== positions.length || times.length !== rotations.length) {
    throw new Error(`움직임 「${motionName}」의 뼈 「${boneName}」 키 배열 길이가 다릅니다`);
  }
  const safe = { times: [], positions: [], rotations: [] };
  let previous = -Infinity;
  for (let index = 0; index < times.length; index++) {
    const time = finite(times[index], `움직임 「${motionName}」 키 시간`);
    const aligned = Math.round(time / step) * step;
    if (time < 0 || time >= length || Math.abs(time - aligned) > 1e-7 || time <= previous) {
      throw new Error(`움직임 「${motionName}」의 뼈 「${boneName}」 키 시간이 올바르지 않습니다`);
    }
    const pos = positions[index];
    if (!Array.isArray(pos) || pos.length !== 2) throw new Error(`움직임 「${motionName}」의 뼈 「${boneName}」 위치가 깨졌습니다`);
    safe.times.push(Number(aligned.toFixed(9)));
    safe.positions.push([integer(pos[0], `뼈 「${boneName}」 X`), integer(pos[1], `뼈 「${boneName}」 Y`)]);
    safe.rotations.push(integer(rotations[index], `뼈 「${boneName}」 각도`));
    previous = time;
  }
  return safe;
}

/** 움직임 이름·설정·트랙을 검사합니다. 1·2단계 파일은 기본 walk 하나로 엽니다. */
export function normalizeAnimations(value, bones) {
  if (value == null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) return defaultAnimations();
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('움직임 자료가 깨졌습니다');
  const boneNames = new Set(normalizeBones(bones).map(bone => bone.name));
  const result = {};
  for (const [rawName, motion] of Object.entries(value)) {
    const name = String(rawName).trim();
    if (!name || name in result) throw new Error('움직임 이름이 비었거나 겹칩니다');
    if (!motion || typeof motion !== 'object' || Array.isArray(motion)) throw new Error(`움직임 「${name}」 자료가 깨졌습니다`);
    const length = finite(motion.length, `움직임 「${name}」 길이`);
    const step = finite(motion.step, `움직임 「${name}」 키 간격`);
    if (length <= 0 || length > 3600 || step <= 0 || step > length) throw new Error(`움직임 「${name}」 길이 또는 키 간격이 올바르지 않습니다`);
    if (!motion.tracks || typeof motion.tracks !== 'object' || Array.isArray(motion.tracks)) throw new Error(`움직임 「${name}」 트랙이 깨졌습니다`);
    const tracks = {};
    for (const [boneName, track] of Object.entries(motion.tracks)) {
      if (!boneNames.has(boneName)) throw new Error(`움직임 「${name}」이 모르는 뼈 「${boneName}」를 가리킵니다`);
      tracks[boneName] = normalizeTrack(track, name, boneName, length, step);
    }
    result[name] = { length, loop: motion.loop !== false, step, tracks };
  }
  if (!Object.keys(result).length) return defaultAnimations();
  return result;
}

/** 뼈 이름·부모·수치와 순환 관계를 검사하고 별도 사본을 돌려줍니다. */
export function normalizeBones(value) {
  if (value == null) return cloneDefaultBones(); // 1단계 파일 호환
  if (!Array.isArray(value) || value.length === 0) throw new Error('뼈 목록이 비어 있거나 깨졌습니다');

  const bones = value.map((bone, index) => {
    if (!bone || typeof bone !== 'object') throw new Error(`${index + 1}번째 뼈가 깨졌습니다`);
    const name = typeof bone.name === 'string' ? bone.name.trim() : '';
    if (!name) throw new Error(`${index + 1}번째 뼈 이름이 비어 있습니다`);
    const parent = bone.parent == null || bone.parent === '' ? null : String(bone.parent).trim();
    if (!Array.isArray(bone.pos) || bone.pos.length !== 2) throw new Error(`뼈 「${name}」 위치가 깨졌습니다`);
    return {
      name,
      parent,
      pos: [finite(bone.pos[0], `뼈 「${name}」 X`), finite(bone.pos[1], `뼈 「${name}」 Y`)],
      angle: finite(bone.angle ?? 90, `뼈 「${name}」 각도`),
      length: Math.max(0, finite(bone.length ?? 4, `뼈 「${name}」 길이`)),
    };
  });

  const names = new Set();
  for (const bone of bones) {
    if (names.has(bone.name)) throw new Error(`뼈 이름 「${bone.name}」이 둘 이상입니다`);
    names.add(bone.name);
  }
  for (const bone of bones) {
    if (bone.parent === bone.name) throw new Error(`뼈 「${bone.name}」은 자기 자신을 부모로 둘 수 없습니다`);
    if (bone.parent && !names.has(bone.parent)) throw new Error(`뼈 「${bone.name}」의 부모 「${bone.parent}」를 찾을 수 없습니다`);
  }

  const byName = new Map(bones.map(bone => [bone.name, bone]));
  for (const start of bones) {
    const seen = new Set([start.name]);
    let current = start;
    while (current.parent) {
      if (seen.has(current.parent)) throw new Error(`뼈 「${start.name}」의 부모 관계가 원을 이룹니다`);
      seen.add(current.parent);
      current = byName.get(current.parent);
    }
  }
  return bones;
}

function normalizeCanvas(value) {
  if (value == null) return [72, 64];
  if (!Array.isArray(value) || value.length !== 2) throw new Error('그림판 크기가 깨졌습니다');
  const width = Math.trunc(finite(value[0], '그림판 너비'));
  const height = Math.trunc(finite(value[1], '그림판 높이'));
  if (width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('그림판 크기가 올바르지 않습니다');
  return [width, height];
}

function normalizePieces(value, slot, item, bones) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('조각 목록이 깨졌습니다');
  const boneNames = new Set(bones.map(bone => bone.name));
  return value.map((piece, index) => {
    if (!piece || typeof piece !== 'object') throw new Error(`${index + 1}번째 조각이 깨졌습니다`);
    const pieceSlot = String(piece.slot || slot);
    const pieceItem = String(piece.item || item);
    const pieceName = String(piece.piece || `piece_${index + 1}`);
    const bone = String(piece.bone || defaultBoneFor(pieceSlot, pieceName, bones));
    if (!boneNames.has(bone)) throw new Error(`조각 「${piece.name || pieceName}」이 모르는 뼈 「${bone}」를 가리킵니다`);
    if (typeof piece.png !== 'string' || !piece.png.startsWith('data:image/png')) throw new Error(`조각 「${piece.name || pieceName}」의 PNG가 깨졌습니다`);
    return {
      slot: pieceSlot,
      item: pieceItem,
      piece: pieceName,
      name: String(piece.name || `${pieceSlot}_${pieceName}`),
      bone,
      zIndex: Number.isFinite(Number(piece.zIndex)) ? Math.trunc(Number(piece.zIndex)) : defaultZIndex(pieceSlot, pieceName),
      visible: piece.visible !== false,
      png: piece.png,
    };
  });
}

export function toProject({ canvas = [72, 64], slot = 'bare', item = '맨몸', basePng = null, pieces = [], bones = null, animations = null, restPose = null } = {}) {
  const safeBones = normalizeBones(bones);
  const safeSlot = String(slot || 'bare');
  const safeItem = String(item || '맨몸');
  if (basePng != null && (typeof basePng !== 'string' || !basePng.startsWith('data:image/png'))) throw new Error('원본 PNG가 깨졌습니다');
  return {
    schema: SCHEMA,
    canvas: normalizeCanvas(canvas),
    slot: safeSlot,
    item: safeItem,
    basePng,
    pieces: normalizePieces(pieces, safeSlot, safeItem, safeBones),
    bones: safeBones,
    animations: normalizeAnimations(animations, safeBones),
    restPose: normalizeRestPose(restPose),
  };
}

/** 작업 파일을 모두 검사합니다. 오류가 나면 호출자는 현재 작업을 그대로 두어야 합니다. */
export function parseProject(json) {
  if (!json || json.schema !== SCHEMA) throw new Error('도트 공장 웹 뼈 애니메이션 파일이 아닙니다');
  return toProject({
    canvas: json.canvas,
    slot: json.slot,
    item: json.item,
    basePng: json.basePng,
    pieces: json.pieces,
    bones: json.bones,
    animations: json.animations,
    restPose: json.restPose,
  });
}
