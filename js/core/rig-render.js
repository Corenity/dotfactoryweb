// 72×64 도트 칸에서 뼈 계층과 최근접 회전을 계산합니다. DOM은 사용하지 않습니다.
import { normalizeBones } from './rig.js';
import { sortRigPiecesByLayers } from './preset-layers.js';

const DEG = Math.PI / 180;
const identity = () => [1, 0, 0, 1, 0, 0];
const translate = (x, y) => [1, 0, 0, 1, x, y];
const rotate = degrees => {
  const r = degrees * DEG, c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
};

/** 두 2D 변환을 합칩니다. 결과는 먼저 right, 그다음 left를 적용합니다. */
export function multiply(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

export function invert(matrix) {
  const [a, b, c, d, e, f] = matrix;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error('뼈 변환을 되돌릴 수 없습니다');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function transformPoint(matrix, x, y) {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

/** 각 뼈의 위치와 각도를 부모부터 합쳐 전역 변환으로 만듭니다. 90°가 원래 방향입니다. */
export function boneWorldTransforms(value) {
  const bones = normalizeBones(value);
  const byName = new Map(bones.map(bone => [bone.name, bone]));
  const result = new Map();

  function visit(bone) {
    if (result.has(bone.name)) return result.get(bone.name);
    const local = multiply(translate(bone.pos[0], bone.pos[1]), rotate(bone.angle - 90));
    const matrix = bone.parent ? multiply(visit(byName.get(bone.parent)).matrix, local) : local;
    const [x, y] = transformPoint(matrix, 0, 0);
    const parentAngle = bone.parent ? visit(byName.get(bone.parent)).angle : 0;
    const entry = { name: bone.name, parent: bone.parent, x, y, angle: parentAngle + bone.angle - 90, matrix };
    result.set(bone.name, entry);
    return entry;
  }

  for (const bone of bones) visit(bone);
  return result;
}

function restBonesFor(bones) {
  // 뼈대 맞추기는 회전 중심을 그림의 관절 자리에 놓는 작업입니다. 현재 위치를 원래 자세로 삼아야
  // 위치를 고칠 때 조각은 제자리에 있고, 각도를 바꿀 때만 그 관절점을 중심으로 돕니다.
  return bones.map(bone => ({ name: bone.name, parent: bone.parent, pos: [...bone.pos], angle: 90, length: bone.length }));
}

/** 현재 뼈가 원래 자세에서 얼마나 움직였는지 조각별 변환으로 만듭니다. */
export function bonePoseTransforms(value, restValue = null) {
  const bones = normalizeBones(value);
  const restBones = restValue == null ? bones : normalizeBones(restValue);
  const rest = boneWorldTransforms(restBonesFor(restBones));
  const posed = boneWorldTransforms(bones);
  const result = new Map();
  for (const bone of bones) result.set(bone.name, multiply(posed.get(bone.name).matrix, invert(rest.get(bone.name).matrix)));
  return result;
}

/** 결과 칸을 거꾸로 원본에 대입해 가장 가까운 칸 하나를 뽑습니다. 그림 크기는 바뀌지 않습니다. */
export function transformNearest(image, matrix) {
  const width = image.width, height = image.height;
  const out = new Uint8ClampedArray(width * height * 4);
  const reverse = invert(matrix);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [sx0, sy0] = transformPoint(reverse, x, y);
      const sx = Math.round(sx0), sy = Math.round(sy0);
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const source = (sy * width + sx) * 4;
      const target = (y * width + x) * 4;
      out[target] = image.data[source];
      out[target + 1] = image.data[source + 1];
      out[target + 2] = image.data[source + 2];
      out[target + 3] = image.data[source + 3];
    }
  }
  return { width, height, data: out };
}

export function rotateNearest(image, pivotX, pivotY, degrees) {
  const aroundPivot = multiply(translate(pivotX, pivotY), multiply(rotate(degrees), translate(-pivotX, -pivotY)));
  return transformNearest(image, aroundPivot);
}

/** 뼈에 붙은 조각을 프리셋 레이어, 층 순서로 그려 미리보기 한 장으로 만듭니다. */
export function composeRig(pieces, bones, width = 72, height = 64, restBones = null, presetLayers = [], options = {}) {
  const transforms = bonePoseTransforms(bones, restBones);
  const out = new Uint8ClampedArray(width * height * 4);
  const ordered = sortRigPiecesByLayers(pieces, presetLayers, options).filter(piece => piece.image);

  for (const piece of ordered) {
    const matrix = transforms.get(piece.bone) || identity();
    const image = transformNearest(piece.image, matrix);
    for (let i = 0; i < out.length; i += 4) {
      const alpha = image.data[i + 3];
      if (!alpha) continue;
      if (alpha === 255 || out[i + 3] === 0) {
        out[i] = image.data[i]; out[i + 1] = image.data[i + 1]; out[i + 2] = image.data[i + 2]; out[i + 3] = alpha;
        continue;
      }
      const top = alpha / 255, below = out[i + 3] / 255 * (1 - top), total = top + below;
      for (let channel = 0; channel < 3; channel++) out[i + channel] = Math.round((image.data[i + channel] * top + out[i + channel] * below) / total);
      out[i + 3] = Math.round(total * 255);
    }
  }
  return { width, height, data: out };
}

/** 화면에서 움직인 전역 칸 수를 선택 뼈 부모의 로컬 칸 수로 바꿉니다. */
export function worldDeltaToLocal(bones, boneName, dx, dy) {
  const bone = normalizeBones(bones).find(item => item.name === boneName);
  if (!bone?.parent) return [dx, dy];
  const parent = boneWorldTransforms(bones).get(bone.parent);
  const radians = -parent.angle * DEG, c = Math.cos(radians), s = Math.sin(radians);
  return [c * dx - s * dy, s * dx + c * dy];
}
