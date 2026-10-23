// rig-1과 project-c용 장면·프리셋·PNG를 한 무압축 ZIP으로 묶고 다시 읽습니다.
import { SLOTS } from './slice.js';
import { toProject, parseProject } from './rig.js';
import { makeGodotTscn, readGodotTscn } from './godot-tscn.js';
import { createStoredZip, readStoredZip, textFromBytes } from './zip.js';

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
  if (width !== 72 || height !== 64) throw new Error(`조각 「${label}」은 72×64여야 합니다. 현재 ${width}×${height}입니다`);
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
  const entries = [], items = new Map(), names = new Set();
  for (const piece of project.pieces) {
    if (!Object.hasOwn(SLOTS, piece.slot) || !SLOTS[piece.slot].includes(piece.piece)) {
      throw new Error(`조각 「${piece.name}」의 칸·조각 이름은 project-c가 모르는 값입니다`);
    }
    const item = filePart(piece.item, `조각 「${piece.name}」의 부위`);
    if (items.has(piece.slot) && items.get(piece.slot) !== item) {
      throw new Error(`칸 「${piece.slot}」에 부위 「${items.get(piece.slot)}」와 「${item}」이 함께 있습니다. 고도 프리셋은 한 칸에 부위 하나만 쓸 수 있습니다`);
    }
    items.set(piece.slot, item);
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
  if (project.canvas[0] !== 72 || project.canvas[1] !== 64) throw new Error(`고도용 그림판은 72×64여야 합니다. 현재 ${project.canvas[0]}×${project.canvas[1]}입니다`);
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
