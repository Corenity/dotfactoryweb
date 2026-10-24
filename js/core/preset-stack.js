// dotfactory-web/preset-stack.js — 프리셋 스택 층(zIndex) 순서 및 덧그리기(Overdraw) 순수 모듈입니다.
// DOM 을 쓰지 않아 Node 시험이 같은 코드를 그대로 돌립니다.
import { transformNearest, pieceTransform, boneWorldTransforms } from './rig-render.js';
import { normalizeBones } from './rig.js';
import { toPreset } from './preset.js';

export const DEFAULT_BARE_LAYERS_META = Object.freeze([
  { id: 'face_face', bone: 'Head', zIndex: 0, slot: 'face', piece: 'face', file: 'assets/bare/face_frame.png' },
  { id: 'bare_leg_l', bone: 'LegL', zIndex: 6, slot: 'bare', piece: 'leg_l', file: 'assets/bare/bare_leg_l.png' },
  { id: 'bare_leg_r', bone: 'LegR', zIndex: 6, slot: 'bare', piece: 'leg_r', file: 'assets/bare/bare_leg_r.png' },
  { id: 'bare_torso', bone: 'Torso', zIndex: 7, slot: 'bare', piece: 'torso', file: 'assets/bare/bare_torso.png' },
  { id: 'bare_arm_l', bone: 'ArmL', zIndex: 11, slot: 'bare', piece: 'arm_l', file: 'assets/bare/bare_arm_l.png' },
  { id: 'bare_arm_r', bone: 'ArmR', zIndex: 11, slot: 'bare', piece: 'arm_r', file: 'assets/bare/bare_arm_r.png' },
]);

/**
 * 프리셋들의 모든 그림을 새 깊이 우선 규칙에 따라 평탄화합니다.
 * 정렬 기준:
 * 1. 깊이(zIndex) 오름차순 (작은 번호가 먼저 깔림)
 * 2. 같은 깊이면 나중에 읽은(넣은 · 불러온) 그림이 위 (presetIndex 오름차순)
 * 3. 같은 프리셋 안에서도 나중 레이어가 위 (layerIndex 오름차순)
 *
 * @param {object|null} barePreset - 기본 맨몸 프리셋
 * @param {Array<object>} overlayPresets - 오버레이 프리셋 목록 (옷, 헤어, 표정 등)
 * @returns {Array<{ presetId: string, presetKind: string, presetIndex: number, layerIndex: number, layer: object }>}
 */
export function flattenPresetStack(barePreset, overlayPresets = []) {
  const result = [];

  if (barePreset && Array.isArray(barePreset.layers)) {
    for (let i = 0; i < barePreset.layers.length; i++) {
      result.push({
        presetId: barePreset.id || 'bare',
        presetKind: barePreset.kind || 'bare',
        presetIndex: 0,
        layerIndex: i,
        layer: barePreset.layers[i],
      });
    }
  }

  const overlays = Array.isArray(overlayPresets) ? overlayPresets : [];
  for (let pIdx = 0; pIdx < overlays.length; pIdx++) {
    const preset = overlays[pIdx];
    if (!preset || !Array.isArray(preset.layers)) continue;
    const presetIndex = pIdx + 1;
    for (let i = 0; i < preset.layers.length; i++) {
      result.push({
        presetId: preset.id || `overlay_${presetIndex}`,
        presetKind: preset.kind || 'outfit',
        presetIndex,
        layerIndex: i,
        layer: preset.layers[i],
      });
    }
  }

  result.sort((a, b) => {
    const zA = Number(a.layer.zIndex) || 0;
    const zB = Number(b.layer.zIndex) || 0;
    if (zA !== zB) return zA - zB;
    if (a.presetIndex !== b.presetIndex) return a.presetIndex - b.presetIndex;
    return a.layerIndex - b.layerIndex;
  });

  return result;
}

/** 보이는 보통 프리셋 레이어 항목을 아래에서 위 순서로 평탄화합니다. */
export function flattenPresetLayers(entries = []) {
  const visible = (Array.isArray(entries) ? entries : []).filter(entry => entry?.visible !== false && entry?.preset);
  if (!visible.length) return [];
  return flattenPresetStack(visible[0].preset, visible.slice(1).map(entry => entry.preset));
}

/**
 * 프리셋 스택 상태를 다루는 헬퍼 객체를 만듭니다.
 */
export function createPresetStack(barePreset = null, overlays = []) {
  let bare = barePreset ? toPreset(barePreset) : null;
  let overlayList = Array.isArray(overlays) ? overlays.map(toPreset) : [];

  return {
    getBare() {
      return bare;
    },
    setBare(newBare) {
      bare = newBare ? toPreset(newBare) : null;
    },
    getOverlays() {
      return overlayList.slice();
    },
    addOverlay(preset) {
      if (!preset) return;
      overlayList.push(toPreset(preset));
    },
    removeOverlay(presetId) {
      overlayList = overlayList.filter(p => p.id !== presetId);
    },
    clearOverlays() {
      overlayList = [];
    },
    flatten() {
      return flattenPresetStack(bare, overlayList);
    },
  };
}

/**
 * 평탄화된 레이어 목록을 순서대로 오버드로우(Overdraw) 합성하여 RGBA 픽셀 버퍼를 만듭니다.
 * @param {Array<{ layer: object }>} flattenedLayers - flattenPresetStack 의 반환값
 * @param {object} options
 * @param {number} [options.width=72]
 * @param {number} [options.height=64]
 * @param {Array|null} [options.bones=null] - 뼈대 정보가 있으면 포즈 변환 적용
 * @param {Array|null} [options.restBones=null] - 뼈대 초기값
 * @returns {{ width: number, height: number, data: Uint8ClampedArray }}
 */
export function composeStackedLayers(flattenedLayers, {
  width = 72,
  height = 64,
  bones = null,
  restBones = null,
} = {}) {
  const out = new Uint8ClampedArray(width * height * 4);
  const normBones = bones ? normalizeBones(bones) : null;
  const restNormBones = bones ? (restBones == null ? normBones : normalizeBones(restBones)) : null;
  const posed = normBones ? boneWorldTransforms(normBones) : null;
  const rest = restNormBones ? boneWorldTransforms(restNormBones.map(b => ({ ...b, angle: 90 }))) : null;

  for (const item of flattenedLayers) {
    const layer = item.layer;
    if (!layer || layer.visible === false) continue;
    let img = layer.imageObj || layer.image;
    if (!img || !img.data) continue;

    if (posed && rest && layer.bone) {
      const matrix = pieceTransform(posed, rest, layer.bone, layer.pos, layer.rot);
      if (matrix) {
        img = transformNearest(img, matrix);
      }
    }

    const imgData = img.data;
    const len = Math.min(out.length, imgData.length);

    for (let i = 0; i < len; i += 4) {
      const alpha = imgData[i + 3];
      if (!alpha) continue;

      if (alpha === 255 || out[i + 3] === 0) {
        out[i] = imgData[i];
        out[i + 1] = imgData[i + 1];
        out[i + 2] = imgData[i + 2];
        out[i + 3] = alpha;
        continue;
      }

      // 알파 블렌딩 합성
      const top = alpha / 255;
      const below = (out[i + 3] / 255) * (1 - top);
      const total = top + below;

      for (let c = 0; c < 3; c++) {
        out[i + c] = Math.round((imgData[i + c] * top + out[i + c] * below) / total);
      }
      out[i + 3] = Math.round(total * 255);
    }
  }

  return { width, height, data: out };
}
