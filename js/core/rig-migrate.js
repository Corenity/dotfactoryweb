// dotfactory-web/rig-migrate.js — 옛 dotfactory-web/rig-1 작업 파일을 skeleton-1, animation-1, preset-1 으로 나눕니다.
import { parseProject } from './rig.js';
import { toSkeleton } from './skeleton.js';
import { toAnimation } from './animation.js';
import { toPreset, PRESET_KINDS } from './preset.js';
import { CURRENT_PROFILE } from './profile.js';

export const SLOT_TO_PRESET_KIND = Object.freeze({
  bare: 'bare',
  outfit: 'outfit',
  face: 'face',
  expression: 'expression',
  hair: 'hair',
  shoes: 'shoes',
  sweat: 'sweat',
  hairpin: 'extra',
  earring: 'extra',
  extra: 'extra',
});

export const PRESET_KIND_NAMES = Object.freeze({
  bare: '기본 맨몸',
  outfit: '의상',
  face: '얼굴틀',
  expression: '표정',
  hair: '헤어',
  shoes: '신발',
  sweat: '상태 기호',
  extra: '기타/장신구',
});

function uniqueLayerId(value, used) {
  const fallback = 'piece';
  const base = String(value || fallback).toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || fallback;
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}_${suffix++}`;
  used.add(id);
  return id;
}

/**
 * 옛 dotfactory-web/rig-1 작업 파일을 세 파일 형식으로 분할 변환합니다.
 * @param {object} project - rig-1 프로젝트 객체
 * @returns {{ skeleton: object, animations: Record<string, object>, presets: object[] }}
 */
export function migrateRig1(project) {
  const safeProject = project && project.schema === 'dotfactory-web/rig-1' ? parseProject(project) : parseProject(project);

  // 1. 뼈 분리 (skeleton-1)
  const skeleton = toSkeleton({
    canvas: safeProject.canvas,
    bones: safeProject.bones,
  });

  // 2. 움직임 분리 (움직임마다 animation-1)
  const animations = {};
  const boneNames = safeProject.bones.map(b => b.name);
  for (const [motionName, motion] of Object.entries(safeProject.animations || {})) {
    animations[motionName] = toAnimation({
      skeleton: CURRENT_PROFILE.skeletonName,
      bones: boneNames,
      motions: { [motionName]: motion },
    });
  }

  // 3. 프리셋 분리 (SLOTS 대조표대로 kind 별 preset-1)
  const groups = new Map();
  for (const kind of PRESET_KINDS) groups.set(kind, []);

  for (const piece of safeProject.pieces || []) {
    const kind = SLOT_TO_PRESET_KIND[piece.slot] || 'extra';
    const list = groups.get(kind) || [];
    list.push(piece);
    groups.set(kind, list);
  }

  const presets = [];
  for (const kind of PRESET_KINDS) {
    const list = groups.get(kind);
    if (!list || list.length === 0) continue;

    const usedIds = new Set();
    const layers = list.map((p, idx) => {
      const pieceName = p.piece || p.name || `piece_${idx + 1}`;
      const layerId = uniqueLayerId(`${p.slot}_${pieceName}`, usedIds);
      return {
        id: layerId,
        bone: p.bone,
        zIndex: p.zIndex != null ? p.zIndex : 0,
        slot: p.slot || '',
        piece: pieceName,
        image: p.png,
      };
    });

    presets.push(toPreset({
      id: `${kind}`,
      name: PRESET_KIND_NAMES[kind] || kind,
      kind,
      canvas: safeProject.canvas,
      layers,
    }));
  }

  return {
    skeleton,
    animations,
    presets,
  };
}
