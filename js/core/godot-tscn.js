// project-c character_rig.tscn 생성·읽기. DOM 없이 브라우저와 Node에서 함께 씁니다.
import { normalizeBones, normalizeAnimations, defaultBoneFor, defaultZIndex, applyRestPose } from './rig.js';
import { boneWorldTransforms } from './rig-render.js';

const DEG = Math.PI / 180;
const SUPPORTED_NODES = new Set(['Node2D', 'Skeleton2D', 'Bone2D', 'Sprite2D', 'AnimationPlayer']);
const SPRITES = Object.freeze([
  ['face', 'face'], ['earring', 'earring'], ['expression', 'cheek'], ['expression', 'nose'], ['expression', 'fx'], ['hair', 'hair'],
  ['expression', 'mouth'], ['expression', 'brows'], ['expression', 'eyes'], ['sweat', 'sweat'], ['hairpin', 'hairpin'],
  ['bare', 'arm_r'], ['outfit', 'arm_r'], ['bare', 'arm_l'], ['outfit', 'arm_l'],
  ['bare', 'torso'], ['outfit', 'body'],
  ['bare', 'foot_r'], ['shoes', 'shoe_r'], ['bare', 'leg_r'], ['outfit', 'leg_r'],
  ['bare', 'foot_l'], ['shoes', 'shoe_l'], ['bare', 'leg_l'], ['outfit', 'leg_l'],
]);
const SPRITE_NAMES = new Set(SPRITES.map(([slot, piece]) => `${slot}_${piece}`));

const rounded = value => Number(Number(value).toFixed(9));

function number(value) {
  const n = rounded(value);
  if (!Number.isFinite(n)) throw new Error('고도 장면에 넣을 숫자가 올바르지 않습니다');
  if (Object.is(n, -0)) return '0';
  return String(n);
}

function quoted(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

function vector(value) {
  return `Vector2(${number(value[0])}, ${number(value[1])})`;
}

function floats(values) {
  return `PackedFloat32Array(${values.map(number).join(', ')})`;
}

function transitions(count) {
  return `PackedFloat32Array(${Array(count).fill('1').join(', ')})`;
}

function restTransform(bone) {
  const radians = (bone.angle - 90) * DEG, c = Math.cos(radians), s = Math.sin(radians);
  return `Transform2D(${number(c)}, ${number(s)}, ${number(-s)}, ${number(c)}, ${number(bone.pos[0])}, ${number(bone.pos[1])})`;
}

function bonePaths(bones) {
  const byName = new Map(bones.map(bone => [bone.name, bone])), result = new Map();
  function pathFor(bone) {
    if (result.has(bone.name)) return result.get(bone.name);
    const path = bone.parent ? `${pathFor(byName.get(bone.parent))}/${bone.name}` : `Skeleton2D/${bone.name}`;
    result.set(bone.name, path);
    return path;
  }
  for (const bone of bones) pathFor(bone);
  return result;
}

function orderedBones(bones) {
  const children = new Map([[null, []]]);
  for (const bone of bones) {
    if (!children.has(bone.parent)) children.set(bone.parent, []);
    children.get(bone.parent).push(bone);
  }
  const result = [];
  function add(parent) {
    for (const bone of children.get(parent) || []) { result.push(bone); add(bone.name); }
  }
  add(null);
  return result;
}

function trackText(index, path, times, values, kind) {
  const encoded = kind === 'position' ? values.map(vector).join(', ') : values.map(value => number((value - 90) * DEG)).join(', ');
  return [
    `tracks/${index}/type = "value"`,
    `tracks/${index}/imported = false`,
    `tracks/${index}/enabled = true`,
    `tracks/${index}/path = NodePath("${quoted(path)}:${kind}")`,
    `tracks/${index}/interp = 0`,
    `tracks/${index}/loop_wrap = true`,
    `tracks/${index}/keys = {`,
    `"times": ${floats(times)},`,
    `"transitions": ${transitions(times.length)},`,
    `"update": 1,`,
    `"values": [${encoded}]`,
    `}`,
  ].join('\n');
}

function animationText(id, motion, paths, bones, reset = false) {
  const lines = [`[sub_resource type="Animation" id="${id}"]`, `length = ${number(reset ? 0.001 : motion.length)}`];
  if (!reset && motion.loop) lines.push('loop_mode = 1');
  if (!reset) lines.push(`step = ${number(motion.step)}`);
  let index = 0;
  for (const bone of bones) {
    const path = paths.get(bone.name);
    if (!path) continue;
    if (reset) {
      lines.push(trackText(index++, path, [0], [bone.pos], 'position'));
      lines.push(trackText(index++, path, [0], [bone.angle], 'rotation'));
      continue;
    }
    const track = motion.tracks ? motion.tracks[bone.name] : null;
    if (!track || !track.times || track.times.length === 0) continue;
    lines.push(trackText(index++, path, track.times, track.positions, 'position'));
    lines.push(trackText(index++, path, track.times, track.rotations, 'rotation'));
  }
  return lines.join('\n');
}

function filePart(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'extra';
  const safe = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
  if (!safe || safe === '.' || safe === '..') return 'extra';
  return safe;
}

function spriteText(slot, piece, parent, position, zIndex, textureId = null, rotation = 0, offset = null) {
  const lines = [`[node name="${slot}_${piece}" type="Sprite2D" parent="${quoted(parent)}"]`];
  if (zIndex !== 0) lines.push(`z_index = ${Math.trunc(zIndex)}`);
  lines.push(`position = ${vector(position)}`);
  if (rotation !== 0) lines.push(`rotation = ${number(rotation * DEG)}`);
  if (offset && (offset[0] !== 0 || offset[1] !== 0)) lines.push(`offset = ${vector(offset)}`);
  if (textureId) lines.push(`texture = ExtResource("${textureId}")`);
  lines.push('centered = false');
  return lines.join('\n');
}

/** rig-1의 뼈·움직임·조각 연결을 project-c 장면 텍스트로 만듭니다. */
export function makeGodotTscn(project) {
  const bones = normalizeBones(project.bones), animations = normalizeAnimations(project.animations, bones);
  const paths = bonePaths(bones);
  const restBones = applyRestPose(bones, project.restPose).bones;
  const restWorld = boneWorldTransforms(restBones.map(bone => ({ ...bone, angle: 90 })));
  const animationEntries = Object.entries(animations);
  const extraPieces = (project.pieces || []).filter(piece => piece.slot === 'extra');
  const extraExtResources = [];
  const extraTextureIds = new Map();
  extraPieces.forEach((piece, index) => {
    const extId = `${index + 2}_${piece.piece}`;
    const item = filePart(piece.item);
    extraExtResources.push(`[ext_resource type="Texture2D" path="res://character/parts/extra/${item}_${piece.piece}.png" id="${extId}"]`);
    extraTextureIds.set(piece.piece, extId);
  });
  const totalLoadSteps = animationEntries.length + 4 + extraExtResources.length;
  const sections = [
    `[gd_scene load_steps=${totalLoadSteps} format=3]`,
    '[ext_resource type="Script" path="res://character/character_rig.gd" id="1_rig"]',
    ...extraExtResources,
  ];
  sections.push(animationText('Animation_RESET', {}, paths, bones, true));
  const ids = [];
  animationEntries.forEach(([name, motion], index) => {
    const id = `Animation_${index + 1}`;
    ids.push([name, id]);
    sections.push(animationText(id, motion, paths, bones));
  });
  sections.push([
    '[sub_resource type="AnimationLibrary" id="AnimationLibrary_main"]',
    '_data = {',
    '&"RESET": SubResource("Animation_RESET"),',
    ...ids.map(([name, id], index) => `&"${quoted(name)}": SubResource("${id}")${index === ids.length - 1 ? '' : ','}`),
    '}',
  ].join('\n'));

  sections.push('[node name="CharacterRig" type="Node2D"]\ntexture_filter = 1\nscript = ExtResource("1_rig")');
  sections.push('[node name="Skeleton2D" type="Skeleton2D" parent="."]');
  const pieces = new Map((project.pieces || []).map(piece => [`${piece.slot}_${piece.piece}`, piece]));
  const spritesByBone = new Map();
  let orderCounter = 0;
  for (const [slot, piece] of SPRITES) {
    const saved = pieces.get(`${slot}_${piece}`), bone = saved?.bone || defaultBoneFor(slot, piece, bones);
    if (!spritesByBone.has(bone)) spritesByBone.set(bone, []);
    spritesByBone.get(bone).push({
      slot,
      piece,
      zIndex: saved?.zIndex ?? defaultZIndex(slot, piece),
      pos: saved?.pos || [0, 0],
      rot: saved?.rot || 0,
      order: orderCounter++,
    });
  }
  for (const piece of project.pieces || []) {
    if (piece.slot === 'extra') {
      const bone = piece.bone || defaultBoneFor('extra', piece.piece, bones);
      if (!spritesByBone.has(bone)) spritesByBone.set(bone, []);
      spritesByBone.get(bone).push({
        slot: 'extra',
        piece: piece.piece,
        zIndex: piece.zIndex ?? defaultZIndex('extra', piece.piece),
        pos: piece.pos || [0, 0],
        rot: piece.rot || 0,
        textureId: extraTextureIds.get(piece.piece),
        order: orderCounter++,
      });
    }
  }

  for (const bone of orderedBones(bones)) {
    const parent = bone.parent ? paths.get(bone.parent) : 'Skeleton2D';
    const lines = [
      `[node name="${quoted(bone.name)}" type="Bone2D" parent="${quoted(parent)}"]`,
      `position = ${vector(bone.pos)}`,
    ];
    if (bone.angle !== 90) lines.push(`rotation = ${number((bone.angle - 90) * DEG)}`);
    lines.push(`rest = ${restTransform(bone)}`, 'auto_calculate_length_and_angle = false', `length = ${number(bone.length)}`, 'bone_angle = 90.0');
    sections.push(lines.join('\n'));
    const sprites = (spritesByBone.get(bone.name) || []).slice().sort((a, b) => {
      const zA = Number(a.zIndex) || 0, zB = Number(b.zIndex) || 0;
      if (zA !== zB) return zA - zB;
      return (a.order ?? 0) - (b.order ?? 0);
    });
    for (const sprite of sprites) {
      const pivot = restWorld.get(bone.name);
      const pos = sprite.pos || [0, 0];
      const rot = sprite.rot || 0;
      const offset = [-Math.round(pivot.x), -Math.round(pivot.y)];
      sections.push(spriteText(sprite.slot, sprite.piece, paths.get(bone.name), pos, sprite.zIndex, sprite.textureId, rot, offset));
    }
  }
  sections.push('[node name="AnimationPlayer" type="AnimationPlayer" parent="."]\nlibraries/ = SubResource("AnimationLibrary_main")');
  return `${sections.join('\n\n')}\n`;
}

/** 순수 Skeleton2D/Bone2D 골격 트리만 담은 고도 씬(.tscn)을 만듭니다 (Sprite2D 미포함). */
export function makeGodotSkeletonTscn(skeleton) {
  const bones = normalizeBones(skeleton?.bones || []);
  const paths = bonePaths(bones);
  const sections = [
    '[gd_scene format=3]',
    '[node name="CharacterSkeleton" type="Node2D"]',
    'texture_filter = 1',
    '[node name="Skeleton2D" type="Skeleton2D" parent="."]',
  ];
  for (const bone of orderedBones(bones)) {
    const parent = bone.parent ? paths.get(bone.parent) : 'Skeleton2D';
    const lines = [
      `[node name="${quoted(bone.name)}" type="Bone2D" parent="${quoted(parent)}"]`,
      `position = ${vector(bone.pos)}`,
    ];
    if (bone.angle !== 90) lines.push(`rotation = ${number((bone.angle - 90) * DEG)}`);
    lines.push(`rest = ${restTransform(bone)}`, 'auto_calculate_length_and_angle = false', `length = ${number(bone.length)}`, 'bone_angle = 90.0');
    sections.push(lines.join('\n'));
  }
  return `${sections.join('\n\n')}\n`;
}

/** 뼈대 기준 AnimationLibrary 리소스(.tres) 텍스트를 만듭니다. */
export function makeGodotAnimationLibrary(animations, skeleton) {
  const bones = normalizeBones(skeleton?.bones || []);
  const safeAnimations = normalizeAnimations(animations?.motions || animations || {}, bones);
  const paths = bonePaths(bones);
  const entries = Object.entries(safeAnimations);
  const totalLoadSteps = entries.length + 1;
  const sections = [`[gd_resource type="AnimationLibrary" load_steps=${totalLoadSteps} format=3]`];
  const ids = [];
  entries.forEach(([name, motion], index) => {
    const id = `Animation_${index + 1}`;
    ids.push([name, id]);
    sections.push(animationText(id, motion, paths, bones));
  });
  sections.push([
    '[resource]',
    '_data = {',
    ...ids.map(([name, id], index) => `&"${quoted(name)}": SubResource("${id}")${index === ids.length - 1 ? '' : ','}`),
    '}',
  ].join('\n'));
  return `${sections.join('\n\n')}\n`;
}

function sectionsOf(text) {
  const matches = [...String(text).matchAll(/^\[([^\]]+)\]\s*$/gm)], result = [];
  for (let i = 0; i < matches.length; i++) {
    result.push({ header: matches[i][1], body: String(text).slice(matches[i].index + matches[i][0].length, matches[i + 1]?.index ?? String(text).length) });
  }
  return result;
}

function attributes(header) {
  const result = {};
  for (const match of header.matchAll(/([A-Za-z_]+)=(?:"((?:\\.|[^"])*)"|([^\s]+))/g)) result[match[1]] = (match[2] ?? match[3]).replaceAll('\\"', '"').replaceAll('\\\\', '\\');
  return result;
}

function property(body, name) {
  const match = body.match(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(.+)$`, 'm'));
  return match?.[1]?.trim();
}

function parseNumber(value, fallback = 0) {
  const found = Number(value);
  return Number.isFinite(found) ? found : fallback;
}

function parseVector(value, fallback = [0, 0]) {
  const match = String(value || '').match(/^Vector2\(\s*([^,]+),\s*([^\)]+)\)$/);
  return match ? [parseNumber(match[1]), parseNumber(match[2])] : [...fallback];
}

function parsePacked(value) {
  const match = String(value || '').match(/^PackedFloat32Array\((.*)\)$/s);
  if (!match || !match[1].trim()) return [];
  return match[1].split(',').map(part => parseNumber(part.trim(), NaN));
}

function keyBlock(body, index) {
  const match = body.match(new RegExp(`tracks/${index}/keys\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'));
  return match?.[1] || '';
}

function parseValues(block, kind) {
  const match = block.match(/^"values"\s*:\s*\[([\s\S]*?)\]\s*,?$/m);
  if (!match) return [];
  if (kind === 'position') return [...match[1].matchAll(/Vector2\(\s*([^,]+),\s*([^\)]+)\)/g)].map(item => [parseNumber(item[1], NaN), parseNumber(item[2], NaN)]);
  if (!match[1].trim()) return [];
  return match[1].split(',').map(part => parseNumber(part.trim(), NaN));
}

function sample(track, time, fallback) {
  if (!track) return fallback;
  let found = fallback;
  for (let i = 0; i < track.times.length && track.times[i] <= time + 1e-7; i++) found = track.values[i];
  return found;
}

function webInteger(value, label, warnings) {
  const next = Math.round(value);
  if (Math.abs(next - value) > 1e-7) warnings.push(`${label}: 웹의 한 칸 단위에 맞춰 ${number(value)}에서 ${next}(으)로 바꿨습니다`);
  return next;
}

/** .tscn에서 웹이 다루는 뼈와 움직임을 읽습니다. 지원하지 않는 항목은 warnings에 남깁니다. */
export function readGodotTscn(text) {
  const source = String(text);
  if (!/^\[gd_scene\b/m.test(source)) throw new Error('고도 장면(.tscn) 파일이 아닙니다');
  const sections = sectionsOf(source), warnings = [], bones = [], animationSections = new Map();
  const nodePaths = new Map();

  for (const section of sections) {
    const head = section.header;
    if (head.startsWith('sub_resource ')) {
      const attr = attributes(head);
      if (attr.type === 'Animation') animationSections.set(attr.id, section.body);
      continue;
    }
    if (!head.startsWith('node ')) continue;
    const attr = attributes(head), type = attr.type || '', name = attr.name || '';
    const isExtraSprite = type === 'Sprite2D' && /^extra_[a-z0-9_]+$/.test(name);
    const known = SUPPORTED_NODES.has(type) && (
      type === 'Bone2D'
      || (type === 'Node2D' && (name === 'CharacterRig' || name === 'CharacterSkeleton'))
      || (type === 'Skeleton2D' && name === 'Skeleton2D')
      || (type === 'AnimationPlayer' && name === 'AnimationPlayer')
      || (type === 'Sprite2D' && (SPRITE_NAMES.has(name) || isExtraSprite))
    );
    if (!known) { warnings.push(`노드 「${name || '(이름 없음)'}」(${type || '형식 없음'})는 지원하지 않아 건너뛰었습니다`); continue; }
    if (type !== 'Bone2D') continue;
    const parentPath = attr.parent || '', parent = /\/([^/]+)$/.exec(parentPath)?.[1] || null;
    const rotation = parseNumber(property(section.body, 'rotation'), 0);
    const bone = {
      name,
      parent: parentPath === 'Skeleton2D' || parentPath.endsWith('/Skeleton2D') ? null : parent,
      pos: parseVector(property(section.body, 'position')),
      angle: rounded(90 + rotation / DEG),
      length: Math.max(0, parseNumber(property(section.body, 'length'), 4)),
    };
    bones.push(bone);
    nodePaths.set(name, `${parentPath}/${name}`.replace(/^\.\//, ''));
  }
  if (!bones.length) throw new Error('고도 장면에서 Bone2D 뼈를 찾을 수 없습니다');
  const safeBones = normalizeBones(bones), boneByName = new Map(safeBones.map(bone => [bone.name, bone]));

  const library = sections.find(section => section.header.startsWith('sub_resource ') && attributes(section.header).type === 'AnimationLibrary');
  if (!library) throw new Error('고도 장면에서 AnimationLibrary를 찾을 수 없습니다');
  const references = [...library.body.matchAll(/&"((?:\\.|[^"])*)"\s*:\s*SubResource\("([^"]+)"\)/g)]
    .map(match => [match[1].replaceAll('\\"', '"').replaceAll('\\\\', '\\'), match[2]]);
  const animations = {};
  for (const [name, id] of references) {
    const body = animationSections.get(id);
    if (!body) { warnings.push(`움직임 「${name}」가 가리키는 자료 「${id}」를 찾지 못해 건너뛰었습니다`); continue; }
    if (name === 'RESET') continue;
    const length = parseNumber(property(body, 'length'), 0.001), step = parseNumber(property(body, 'step'), 0.1);
    const loop = parseNumber(property(body, 'loop_mode'), 0) === 1;
    const raw = new Map();
    const indexes = [...body.matchAll(/^tracks\/(\d+)\/type\s*=/gm)].map(match => Number(match[1]));
    for (const index of indexes) {
      const type = String(property(body, `tracks/${index}/type`) || '').replaceAll('"', '');
      const pathValue = property(body, `tracks/${index}/path`), pathMatch = String(pathValue || '').match(/^NodePath\("(.+):([^:"]+)"\)$/);
      const interp = parseNumber(property(body, `tracks/${index}/interp`), 1);
      if (type !== 'value' || !pathMatch) { warnings.push(`움직임 「${name}」의 ${index + 1}번째 트랙은 값 트랙이 아니라 건너뛰었습니다`); continue; }
      if (interp !== 0) { warnings.push(`움직임 「${name}」의 트랙 「${pathMatch[1]}:${pathMatch[2]}」은 끊김 보간이 아니라 건너뛰었습니다`); continue; }
      const boneName = pathMatch[1].split('/').at(-1), kind = pathMatch[2];
      if (!boneByName.has(boneName) || nodePaths.get(boneName) !== pathMatch[1]) { warnings.push(`움직임 「${name}」의 모르는 뼈 트랙 「${pathMatch[1]}」을 건너뛰었습니다`); continue; }
      if (kind !== 'position' && kind !== 'rotation') { warnings.push(`움직임 「${name}」의 속성 트랙 「${pathMatch[2]}」을 건너뛰었습니다`); continue; }
      const block = keyBlock(body, index), timesMatch = block.match(/^"times"\s*:\s*(PackedFloat32Array\([^\n]*\))/m);
      const times = parsePacked(timesMatch?.[1]), values = parseValues(block, kind);
      if (times.length !== values.length || times.some(value => !Number.isFinite(value)) || values.flat().some(value => !Number.isFinite(value))) {
        warnings.push(`움직임 「${name}」의 트랙 「${pathMatch[1]}:${kind}」 키 배열이 깨져 건너뛰었습니다`);
        continue;
      }
      if (!raw.has(boneName)) raw.set(boneName, {});
      raw.get(boneName)[kind] = { times, values };
    }

    const tracks = {};
    for (const [boneName, pair] of raw) {
      const base = boneByName.get(boneName), times = [...new Set([...(pair.position?.times || []), ...(pair.rotation?.times || [])])].sort((a, b) => a - b);
      const kept = times.filter(time => time >= 0 && time < length);
      if (kept.length !== times.length) warnings.push(`움직임 「${name}」의 뼈 「${boneName}」에서 길이 밖 키를 건너뛰었습니다`);
      if (!kept.length) continue;
      tracks[boneName] = {
        times: kept.map(rounded),
        positions: kept.map(time => sample(pair.position, time, base.pos).map((value, axis) => webInteger(value, `움직임 「${name}」 ${boneName} ${axis ? 'Y' : 'X'}`, warnings))),
        rotations: kept.map(time => webInteger(90 + sample(pair.rotation, time, (base.angle - 90) * DEG) / DEG, `움직임 「${name}」 ${boneName} 각도`, warnings)),
      };
    }
    animations[name] = { length, loop, step, tracks };
  }
  return { bones: safeBones, animations: normalizeAnimations(animations, safeBones), warnings };
}
