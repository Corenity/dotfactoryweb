// rig-1과 project-c용 장면·프리셋·PNG를 한 무압축 ZIP으로 묶고 다시 읽습니다.
import { SLOTS, isValidPieceName } from './slice.js';
import { toProject, parseProject, DEFAULT_BONES } from './rig.js';
import { makeGodotTscn, readGodotTscn, makeGodotSkeletonTscn, makeGodotAnimationLibrary } from './godot-tscn.js';
import { createStoredZip, readStoredZip, textFromBytes } from './zip.js';
import { normalizeSkeletonBones } from './skeleton.js';
import { boneWorldTransforms } from './rig-render.js';
import { sha256Hex } from './hash.js';
import { toPreset } from './preset.js';
import { CURRENT_PROFILE, currentCanvas } from './profile.js';

const RIG_FILE = 'dotfactory-rig.json';
const TSCN_FILE = 'character/character_rig.tscn';
const PRESET_FILE = 'character/presets/dotfactory-web.tres';
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64(value) {
  const clean = String(value).replace(/\s/g, '');
  if (clean.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(clean)) throw new Error('PNG의 base64 자료가 깨졌습니다');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const result = new Uint8Array(clean.length / 4 * 3 - padding);
  let at = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = BASE64.indexOf(clean[i]), b = BASE64.indexOf(clean[i + 1]);
    const c = clean[i + 2] === '=' ? 0 : BASE64.indexOf(clean[i + 2]);
    const d = clean[i + 3] === '=' ? 0 : BASE64.indexOf(clean[i + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('PNG의 base64 자료가 깨졌습니다');
    const bits = (a << 18) | (b << 12) | (c << 6) | d;
    if (at < result.length) result[at++] = bits >>> 16;
    if (at < result.length) result[at++] = (bits >>> 8) & 0xff;
    if (at < result.length) result[at++] = bits & 0xff;
  }
  return result;
}

function pngBytes(dataUrl, label) {
  const match = String(dataUrl || '').match(/^data:image\/png(?:;[^,]*)?;base64,(.*)$/s);
  if (!match) throw new Error(`조각 「${label}」의 PNG가 깨졌습니다`);
  const bytes = decodeBase64(match[1]);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || signature.some((value, index) => bytes[index] !== value) || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') {
    throw new Error(`조각 「${label}」이 PNG 파일이 아닙니다`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  const [expectedWidth, expectedHeight] = CURRENT_PROFILE.canvas;
  if (width !== expectedWidth || height !== expectedHeight) throw new Error(`조각 「${label}」은 ${expectedWidth}×${expectedHeight}여야 합니다. 현재 ${width}×${height}입니다`);
  return bytes;
}

function filePart(value, label) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error(`${label} 이름이 비어 있습니다`);
  const safe = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
  if (!safe || safe === '.' || safe === '..') throw new Error(`${label} 이름 「${raw}」을 파일 이름으로 쓸 수 없습니다`);
  return safe;
}

function quoted(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

function presetText(items) {
  const entries = [...items.entries()];
  return [
    '[gd_resource type="Resource" script_class="CharacterPreset" load_steps=2 format=3]',
    '',
    '[ext_resource type="Script" path="res://character/character_preset.gd" id="1_preset"]',
    '',
    '[resource]',
    'script = ExtResource("1_preset")',
    'format_version = 1',
    'parts = Dictionary[String, String]({',
    ...entries.map(([slot, item], index) => `"${quoted(slot)}": "${quoted(item)}"${index === entries.length - 1 ? '' : ','}`),
    '})',
    '',
  ].join('\n');
}

function exportParts(project) {
  const entries = [], items = new Map(), names = new Set(), extraPieceNames = new Set();
  for (const piece of project.pieces) {
    if (piece.slot === 'extra') {
      if (!isValidPieceName(piece.piece)) {
        throw new Error(`조각 「${piece.name}」의 이름이 올바르지 않습니다`);
      }
      if (extraPieceNames.has(piece.piece)) {
        throw new Error(`기타 조각 이름 「${piece.piece}」이 둘 이상입니다`);
      }
      extraPieceNames.add(piece.piece);
    } else {
      if (!Object.hasOwn(SLOTS, piece.slot) || !SLOTS[piece.slot].includes(piece.piece)) {
        throw new Error(`조각 「${piece.name}」의 칸·조각 이름은 ${CURRENT_PROFILE.id}가 모르는 값입니다`);
      }
      const item = filePart(piece.item, `조각 「${piece.name}」의 부위`);
      if (items.has(piece.slot) && items.get(piece.slot) !== item) {
        throw new Error(`칸 「${piece.slot}」에 부위 「${items.get(piece.slot)}」와 「${item}」이 함께 있습니다. 고도 프리셋은 한 칸에 부위 하나만 쓸 수 있습니다`);
      }
      items.set(piece.slot, item);
    }
    const item = filePart(piece.item, `조각 「${piece.name}」의 부위`);
    const path = `character/parts/${piece.slot}/${item}_${piece.piece}.png`;
    if (names.has(path)) throw new Error(`고도 PNG 경로 「${path}」가 둘 이상입니다`);
    names.add(path);
    entries.push({ name: path, data: pngBytes(piece.png, piece.name) });
  }
  return { entries, items };
}

/** project-c res://에 바로 풀 수 있는 ZIP과 안쪽 텍스트를 만듭니다. */
export function makeGodotExport(value) {
  const project = parseProject(value?.schema ? value : toProject(value));
  const [expectedWidth, expectedHeight] = CURRENT_PROFILE.canvas;
  if (project.canvas[0] !== expectedWidth || project.canvas[1] !== expectedHeight) throw new Error(`고도용 그림판은 ${expectedWidth}×${expectedHeight}여야 합니다. 현재 ${project.canvas[0]}×${project.canvas[1]}입니다`);
  const tscn = makeGodotTscn(project), parts = exportParts(project), preset = presetText(parts.items);
  const entries = [
    { name: TSCN_FILE, data: tscn },
    { name: PRESET_FILE, data: preset },
    ...parts.entries,
    { name: RIG_FILE, data: `${JSON.stringify(project, null, 2)}\n` },
  ];
  return { bytes: createStoredZip(entries), entries, tscn, preset };
}

export function projectFromGodotTscn(text) {
  const parsed = readGodotTscn(text);
  return { project: toProject({ bones: parsed.bones, animations: parsed.animations }), warnings: parsed.warnings };
}

/** 웹 ZIP은 rig-1의 그림 자료를 바탕으로 .tscn의 뼈·움직임을 우선 반영합니다. */
export function projectFromGodotZip(bytes) {
  const files = readStoredZip(bytes), sceneBytes = files.get(TSCN_FILE);
  if (!sceneBytes) throw new Error(`ZIP에서 「${TSCN_FILE}」을 찾을 수 없습니다`);
  const parsed = readGodotTscn(textFromBytes(sceneBytes));
  const rigBytes = files.get(RIG_FILE);
  if (!rigBytes) return { project: toProject({ bones: parsed.bones, animations: parsed.animations }), warnings: parsed.warnings };
  let backup;
  try {
    backup = parseProject(JSON.parse(textFromBytes(rigBytes)));
  } catch (err) {
    throw new Error(`ZIP 안의 「${RIG_FILE}」을 읽을 수 없습니다: ${err.message}`);
  }
  return {
    project: toProject({ ...backup, bones: parsed.bones, animations: parsed.animations }),
    warnings: parsed.warnings,
  };
}

export const GODOT_EXPORT_PATHS = Object.freeze({ rig: RIG_FILE, scene: TSCN_FILE, preset: PRESET_FILE });

/**
 * 뼈·애니메이션·프리셋을 단일 번들 ZIP(package.json 매니페스트 포함)으로 패키징합니다.
 * 부분 내보내기(selected)를 지원하며, 선택하지 않은 항목은 targets에서 null이고 파일이 번들에 포함되지 않습니다.
 *
 * @param {object} params
 * @param {object|null} [params.skeleton] - skeleton-1 객체 ({ canvas, bones })
 * @param {object|null} [params.animation] - animation-1 객체 ({ skeleton, bones, motions })
 * @param {Array<object>} [params.presets] - preset-1 객체 배열
 * @param {object} [params.selected] - { skeleton: boolean, animation: boolean, presets: boolean }
 * @param {string|null} [params.createdAt] - package.json created_at (null이면 현재 시각)
 * @param {string} [params.generator='DotFactoryWeb']
 * @param {[number, number]} [params.canvas] 프로필 기본 그림판 크기
 * @returns {{ bytes: Uint8Array, entries: Array<{ name: string, data: string|Uint8Array }>, packageJson: object }}
 */
export function makeBundle({
  skeleton = null,
  animation = null,
  presets = [],
  selected = { skeleton: true, animation: true, presets: true },
  createdAt = null,
  generator = 'DotFactoryWeb',
  canvas = currentCanvas(),
} = {}) {
  const isSkeletonSelected = Boolean(selected?.skeleton && skeleton);
  const isAnimationSelected = Boolean(selected?.animation && animation);
  const isPresetsSelected = Boolean(selected?.presets && presets && presets.length > 0);

  const targets = {
    skeleton: null,
    animation: null,
    presets_dir: null,
    images_dir: null,
  };

  const entries = [];
  const items = [];
  const skeletonFile = `${CURRENT_PROFILE.skeletonName}.tscn`;

  // 1. 뼈대 (Skeleton)
  if (isSkeletonSelected) {
    targets.skeleton = {
      bundle_file: skeletonFile,
      suggested_dest: `res://character/${skeletonFile}`,
      type: 'PackedScene',
    };
    entries.push({
      name: skeletonFile,
      data: makeGodotSkeletonTscn(skeleton),
    });
  }

  // 2. 애니메이션 (Animation)
  if (isAnimationSelected) {
    const motions = Object.keys(animation?.motions || {});
    targets.animation = {
      bundle_file: 'character_animations.tres',
      suggested_dest: 'res://character/character_animations.tres',
      type: 'AnimationLibrary',
      motions,
    };
    entries.push({
      name: 'character_animations.tres',
      data: makeGodotAnimationLibrary(animation, skeleton),
    });
  }

  // 3. 프리셋 (Presets)
  if (isPresetsSelected) {
    targets.presets_dir = 'res://character/presets';
    targets.images_dir = 'res://character/images';

    const bones = normalizeSkeletonBones(skeleton?.bones || DEFAULT_BONES);
    const restWorld = boneWorldTransforms(bones.map(b => ({ ...b, angle: 90 })));
    const addedImages = new Set();

    for (const rawPreset of presets) {
      if (!rawPreset) continue;
      const preset = toPreset(rawPreset);
      const presetId = filePart(preset.id, '프리셋 ID');

      // 프리셋 JSON 파일: presets/<preset_id>.json
      const presetPath = `presets/${presetId}.json`;
      entries.push({
        name: presetPath,
        data: `${JSON.stringify(preset, null, 2)}\n`,
      });

      // 각 레이어 처리
      for (const layer of preset.layers || []) {
        const rawDataUrl = layer.image || layer.png;
        if (!rawDataUrl) continue;
        const pieceId = layer.id || `${presetId}_${layer.piece}`;
        const bundlePngPath = `parts/${presetId}/${pieceId}.png`;
        const bytes = pngBytes(rawDataUrl, pieceId);
        const hash = sha256Hex(bytes).slice(0, 16);
        const pivot = restWorld.get(layer.bone) || { x: 0, y: 0 };
        const offset = [-Math.round(pivot.x), -Math.round(pivot.y)];
        const pos = layer.pos ? [layer.pos[0], layer.pos[1]] : [0, 0];
        const rot = layer.rot || 0;

        items.push({
          preset_id: preset.id,
          preset_name: preset.name,
          kind: preset.kind,
          piece_id: pieceId,
          bundle_file: bundlePngPath,
          original_name: layer.original_name || `${pieceId}.png`,
          content_hash: hash,
          suggested_table_id: pieceId,
          suggested_dest_file: `res://character/images/${pieceId}.png`,
          bone: layer.bone,
          zIndex: layer.zIndex ?? 0,
          pos,
          rot,
          slot: layer.slot || preset.kind,
          piece: layer.piece,
          offset,
        });

        if (!addedImages.has(bundlePngPath)) {
          addedImages.add(bundlePngPath);
          entries.push({
            name: bundlePngPath,
            data: bytes,
          });
        }
      }
    }
  }

  const pkg = {
    schema: 'dotfactory-bundle-1',
    created_at: createdAt || new Date().toISOString(),
    generator,
    canvas: canvas || currentCanvas(),
    targets,
    items,
  };

  entries.unshift({
    name: 'package.json',
    data: `${JSON.stringify(pkg, null, 2)}\n`,
  });

  return {
    bytes: createStoredZip(entries),
    entries,
    packageJson: pkg,
  };
}
