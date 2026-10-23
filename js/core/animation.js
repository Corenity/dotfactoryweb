// dotfactory-web/animation-1 순수 모듈 — 움직임 키, 기준 뼈 메타데이터, 뼈 호환성 검사 및 움직임 병합을 다룹니다.

export const SCHEMA = 'dotfactory-web/animation-1';
export const DEFAULT_SKELETON = 'character_skeleton';

function finiteNumber(val, label, { min = -Infinity, max = Infinity } = {}) {
  const num = Number(val);
  if (!Number.isFinite(num)) throw new Error(`${label} 값이 올바르지 않습니다`);
  if (num < min || num > max) throw new Error(`${label} 값(${num})이 허용 범위(${min}~${max})를 벗어났습니다`);
  return num;
}

export function normalizeTrack(track, motionName, boneName, length) {
  if (!track || typeof track !== 'object' || Array.isArray(track)) {
    throw new Error(`움직임 「${motionName}」의 뼈 「${boneName}」 트랙 자료가 깨졌습니다`);
  }
  const timesRaw = track.times;
  const posRaw = track.positions;
  const rotRaw = track.rotations;

  if (!Array.isArray(timesRaw) || !Array.isArray(posRaw) || !Array.isArray(rotRaw)) {
    throw new Error(`움직임 「${motionName}」의 뼈 「${boneName}」 키 배열이 올바르지 않습니다`);
  }
  if (timesRaw.length !== posRaw.length || timesRaw.length !== rotRaw.length) {
    throw new Error(`움직임 「${motionName}」의 뼈 「${boneName}」 키 배열 길이가 서로 다릅니다`);
  }

  const count = timesRaw.length;
  const times = [];
  const positions = [];
  const rotations = [];
  let prevTime = -1;

  for (let i = 0; i < count; i++) {
    const t = finiteNumber(timesRaw[i], `움직임 「${motionName}」 뼈 「${boneName}」 키 시간 #${i + 1}`, { min: 0, max: length });
    if (t >= length) {
      throw new Error(`움직임 「${motionName}」 뼈 「${boneName}」 키 시간(${t})은 길이(${length}) 미만이어야 합니다`);
    }
    if (t <= prevTime) {
      throw new Error(`움직임 「${motionName}」 뼈 「${boneName}」 키 시간이 오름차순이 아니거나 겹칩니다`);
    }
    prevTime = t;

    const p = posRaw[i];
    if (!Array.isArray(p) || p.length !== 2) {
      throw new Error(`움직임 「${motionName}」 뼈 「${boneName}」 #${i + 1} 위치 좌표가 올바르지 않습니다`);
    }
    const px = Math.round(finiteNumber(p[0], `움직임 「${motionName}」 뼈 「${boneName}」 #${i + 1} X`));
    const py = Math.round(finiteNumber(p[1], `움직임 「${motionName}」 뼈 「${boneName}」 #${i + 1} Y`));

    const r = finiteNumber(rotRaw[i], `움직임 「${motionName}」 뼈 「${boneName}」 #${i + 1} 각도`);

    times.push(t);
    positions.push([px, py]);
    rotations.push(r);
  }

  return { times, positions, rotations };
}

export function normalizeMotions(dict) {
  if (!dict || typeof dict !== 'object' || Array.isArray(dict)) {
    throw new Error('최소 하나 이상의 움직임이 필요합니다');
  }
  const entries = Object.entries(dict);
  if (entries.length === 0) {
    throw new Error('최소 하나 이상의 움직임이 필요합니다');
  }

  const result = {};
  for (const [rawName, motion] of entries) {
    const name = String(rawName).trim();
    if (!name) throw new Error('움직임 이름이 비어 있습니다');
    if (name in result) throw new Error(`움직임 이름 「${name}」이 겹칩니다`);
    if (!motion || typeof motion !== 'object' || Array.isArray(motion)) {
      throw new Error(`움직임 「${name}」 자료가 깨졌습니다`);
    }

    const length = finiteNumber(motion.length != null ? motion.length : 0.8, `움직임 「${name}」 길이`, { min: 0.001, max: 3600 });
    const step = finiteNumber(motion.step != null ? motion.step : 0.1, `움직임 「${name}」 키 간격`, { min: 0.001, max: length });
    const loop = motion.loop !== false;

    if (!motion.tracks || typeof motion.tracks !== 'object' || Array.isArray(motion.tracks)) {
      throw new Error(`움직임 「${name}」 트랙 목록이 깨졌습니다`);
    }

    const tracks = {};
    for (const [boneName, track] of Object.entries(motion.tracks)) {
      const bName = String(boneName).trim();
      if (!bName) throw new Error(`움직임 「${name}」에 이름 없는 뼈 트랙이 있습니다`);
      tracks[bName] = normalizeTrack(track, name, bName, length);
    }

    result[name] = { length, step, loop, tracks };
  }

  return result;
}

export function toAnimation({ skeleton = DEFAULT_SKELETON, bones = [], motions = null } = {}) {
  const safeSkeleton = String(skeleton || DEFAULT_SKELETON).trim();
  if (!safeSkeleton) throw new Error('기준 뼈 파일명이 비어 있습니다');

  const safeBones = Array.isArray(bones) ? bones.map(b => (typeof b === 'string' ? b : b && b.name)).filter(Boolean) : [];
  const safeMotions = normalizeMotions(motions);

  return {
    schema: SCHEMA,
    skeleton: safeSkeleton,
    bones: safeBones,
    motions: safeMotions,
  };
}

export function parseAnimation(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('애니메이션 파일 자료가 깨졌습니다');
  if (json.schema !== SCHEMA) throw new Error('도트 공장 웹 애니메이션 파일이 아닙니다');
  return toAnimation({
    skeleton: json.skeleton,
    bones: json.bones,
    motions: json.motions,
  });
}

export function serializeAnimation(animation, space = 2) {
  return JSON.stringify(toAnimation(animation), null, space);
}

export function deserializeAnimation(text) {
  if (typeof text !== 'string') throw new Error('애니메이션 텍스트 자료가 올바르지 않습니다');
  return parseAnimation(JSON.parse(text));
}

/**
 * 다른 뼈대에 애니메이션을 붙일 때, 대상 뼈대에 없는 뼈 트랙을 찾아 경고를 보고합니다.
 * @param {object} animation - dotfactory-web/animation-1 객체
 * @param {Array<object|string>} targetBones - 대상 뼈 목록 (Bone 객체 배열 또는 이름 배열)
 * @returns {{ compatible: boolean, missingBones: string[], warnings: string[] }}
 */
export function checkSkeletonCompatibility(animation, targetBones) {
  const targetNames = new Set(
    (Array.isArray(targetBones) ? targetBones : [])
      .map(b => (typeof b === 'string' ? b : b && b.name))
      .filter(Boolean)
  );

  const missingSet = new Set();
  const motions = animation && animation.motions ? animation.motions : {};

  for (const motion of Object.values(motions)) {
    if (!motion || !motion.tracks) continue;
    for (const boneName of Object.keys(motion.tracks)) {
      if (!targetNames.has(boneName)) {
        missingSet.add(boneName);
      }
    }
  }

  const missingBones = Array.from(missingSet);
  const warnings = missingBones.map(b => `뼈대에 없는 뼈 「${b}」의 움직임 키는 보존되지만 화면에는 반영되지 않습니다`);

  return {
    compatible: missingBones.length === 0,
    missingBones,
    warnings,
  };
}

/**
 * 대상 뼈대에 존재하는 뼈의 트랙만 남기거나 필터링하는 헬퍼 함수입니다.
 */
export function adaptAnimationToBones(animation, targetBones) {
  const targetNames = new Set(
    (Array.isArray(targetBones) ? targetBones : [])
      .map(b => (typeof b === 'string' ? b : b && b.name))
      .filter(Boolean)
  );

  const anim = animation && animation.motions ? animation : toAnimation(animation);
  const result = {};

  for (const [name, motion] of Object.entries(anim.motions)) {
    const tracks = {};
    for (const [boneName, track] of Object.entries(motion.tracks || {})) {
      if (targetNames.has(boneName)) {
        tracks[boneName] = {
          times: [...track.times],
          positions: track.positions.map(p => [...p]),
          rotations: [...track.rotations],
        };
      }
    }
    result[name] = {
      length: motion.length,
      step: motion.step,
      loop: motion.loop,
      tracks,
    };
  }

  return result;
}

/**
 * 기존 움직임 목록에 새로 불러온 움직임을 병합합니다.
 * 같은 이름의 움직임은 덮어쓰고, 새로운 움직임은 추가합니다.
 * @param {object} existing - 기존 motions 객체
 * @param {object} incoming - 새로 불러온 motions 객체
 * @returns {{ motions: object, addedCount: number, overwrittenCount: number, totalIncomingCount: number }}
 */
export function mergeAnimations(existing = {}, incoming = {}) {
  const safeExisting = existing && typeof existing === 'object' ? { ...existing } : {};
  const safeIncoming = incoming && typeof incoming === 'object' ? incoming : {};

  let addedCount = 0;
  let overwrittenCount = 0;
  const merged = { ...safeExisting };

  for (const [name, motion] of Object.entries(safeIncoming)) {
    if (name in safeExisting) {
      overwrittenCount++;
    } else {
      addedCount++;
    }
    merged[name] = motion;
  }

  return {
    motions: merged,
    addedCount,
    overwrittenCount,
    totalIncomingCount: Object.keys(safeIncoming).length,
  };
}
