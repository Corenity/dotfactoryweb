// 움직임의 끊어지는 자세와 GIF 프레임을 계산하는 순수 모듈입니다.
import { normalizeBones } from './rig.js';
import { composeRig } from './rig-render.js';

const EPSILON = 1e-7;

function cloneMotion(motion) {
  const tracks = {};
  for (const [name, track] of Object.entries(motion.tracks)) {
    tracks[name] = { times: [...track.times], positions: track.positions.map(pos => [...pos]), rotations: [...track.rotations] };
  }
  return { length: motion.length, loop: motion.loop, step: motion.step, tracks };
}

/** 길이를 바꾸고 새 길이부터 뒤에 있는 키를 함께 지웁니다. */
export function changeMotionLength(motion, length) {
  const next = cloneMotion(motion);
  const nextLength = Number(length);
  let removed = 0;
  next.length = nextLength;
  for (const [name, track] of Object.entries(next.tracks)) {
    for (let index = track.times.length - 1; index >= 0; index--) {
      if (track.times[index] < nextLength) continue;
      track.times.splice(index, 1);
      track.positions.splice(index, 1);
      track.rotations.splice(index, 1);
      removed++;
    }
    if (!track.times.length) delete next.tracks[name];
  }
  return { motion: next, removed };
}

/** 키 간격을 바꿨을 때 새 시간 칸에 맞지 않는 키 수를 셉니다. */
export function changeMotionStep(motion, step) {
  const next = cloneMotion(motion);
  const nextStep = Number(step);
  next.step = nextStep;
  let mismatched = 0;
  if (Number.isFinite(nextStep) && nextStep > 0) {
    for (const track of Object.values(next.tracks)) {
      for (const time of track.times) {
        const aligned = Math.round(time / nextStep) * nextStep;
        if (Math.abs(time - aligned) > EPSILON) mismatched++;
      }
    }
  }
  return { motion: next, mismatched };
}

export function frameTimes(motion) {
  const count = Math.max(1, Math.ceil((motion.length - EPSILON) / motion.step));
  return Array.from({ length: count }, (_, index) => Number((index * motion.step).toFixed(9)));
}

function motionTime(motion, time) {
  const raw = Number.isFinite(Number(time)) ? Number(time) : 0;
  if (motion.loop) return ((raw % motion.length) + motion.length) % motion.length;
  return Math.max(0, Math.min(raw, Math.max(0, motion.length - EPSILON)));
}

function keyIndexAt(track, time) {
  let found = -1;
  for (let index = 0; index < track.times.length; index++) {
    if (track.times[index] > time + EPSILON) break;
    found = index;
  }
  return found;
}

/** 키 전에는 뼈대 자세, 키 뒤와 키 사이에는 가장 가까운 앞 키 값을 그대로 씁니다. */
export function poseAt(bones, motion, time) {
  const safeBones = normalizeBones(bones);
  const at = motionTime(motion, time);
  return safeBones.map(bone => {
    const track = motion.tracks[bone.name];
    const index = track ? keyIndexAt(track, at) : -1;
    if (index < 0) return { ...bone, pos: [...bone.pos] };
    return { ...bone, pos: [...track.positions[index]], angle: track.rotations[index] };
  });
}

export function hasKey(motion, boneName, time) {
  const track = motion.tracks[boneName];
  return Boolean(track && track.times.some(value => Math.abs(value - time) <= EPSILON));
}

export function setKey(motion, boneName, time, pose) {
  const next = cloneMotion(motion);
  const track = next.tracks[boneName] || { times: [], positions: [], rotations: [] };
  const existing = track.times.findIndex(value => Math.abs(value - time) <= EPSILON);
  const index = existing >= 0 ? existing : track.times.findIndex(value => value > time);
  const at = index < 0 ? track.times.length : index;
  if (existing < 0) {
    track.times.splice(at, 0, time);
    track.positions.splice(at, 0, [...pose.pos]);
    track.rotations.splice(at, 0, pose.angle);
  } else {
    track.positions[at] = [...pose.pos];
    track.rotations[at] = pose.angle;
  }
  next.tracks[boneName] = track;
  return next;
}

export function deleteKey(motion, boneName, time) {
  const next = cloneMotion(motion);
  const track = next.tracks[boneName];
  if (!track) return next;
  const index = track.times.findIndex(value => Math.abs(value - time) <= EPSILON);
  if (index < 0) return next;
  track.times.splice(index, 1); track.positions.splice(index, 1); track.rotations.splice(index, 1);
  if (!track.times.length) delete next.tracks[boneName];
  return next;
}

/** 바로 앞 시간 칸에 보이던 자세를 현재 칸의 키로 복사합니다. */
export function copyPreviousKey(bones, motion, boneName, time) {
  if (time < motion.step - EPSILON) return motion;
  const pose = poseAt(bones, motion, time - motion.step).find(bone => bone.name === boneName);
  return pose ? setKey(motion, boneName, time, pose) : motion;
}

export function renderMotionFrames(pieces, bones, motion, width = 72, height = 64, presetLayers = []) {
  const times = frameTimes(motion);
  return {
    times,
    frames: times.map(time => composeRig(pieces, poseAt(bones, motion, time), width, height, bones, presetLayers)),
    delays: times.map(() => Math.max(10, Math.round(motion.step * 1000 / 10) * 10)),
  };
}
