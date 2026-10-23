// site/js/character-view.js — 캐릭터 단일 화면
// 기준 뼈대 표시, 맨몸 프리셋 캐시 및 오버레이 순서 관리, 애니메이션 검증, 재생 및 두 ZIP 내보내기를 담당합니다.
import { DEFAULT_BONES } from './core/rig.js';
import { poseAt } from './core/motion.js';
import { toPreset, parsePreset } from './core/preset.js';
import { parseAnimation } from './core/animation.js';
import { DEFAULT_BARE_LAYERS_META, composeStackedLayers } from './core/preset-stack.js';
import { makeBundle, makeGodotExport } from './core/godot-export.js';
import { makeBackgroundTransparent } from './core/background.js';
import { pickFiles, readImageFile, toPngDataUrl, saveFile } from './io.js';
import {
  normalizeCharacterState,
  addCharacterPreset,
  removeCharacterPreset,
  moveCharacterPreset,
  addCharacterAnimation,
  removeCharacterAnimation,
  flattenedCharacterLayers,
  characterMotionOptions,
  inspectCharacter,
  characterBundleInput,
  characterGodotProject,
} from './core/character.js';

const $ = sel => document.querySelector(sel);

const imageCache = new Map();
const pendingDecodes = new Set();

function decodeDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      resolve({ width: c.width, height: c.height, data });
    };
    img.onerror = () => reject(new Error('그림을 읽지 못했습니다'));
    img.src = dataUrl;
  });
}

let defaultBarePreset = null;
let defaultBareLoading = null;

async function loadDefaultBare() {
  if (defaultBarePreset) return defaultBarePreset;
  if (defaultBareLoading) return defaultBareLoading;
  defaultBareLoading = (async () => {
    const layers = [];
    for (const meta of DEFAULT_BARE_LAYERS_META) {
      try {
        const res = await fetch(meta.file);
        if (!res.ok) continue;
        const blob = await res.blob();
        const img = await readImageFile(blob);
        const { image: cleanImg } = makeBackgroundTransparent(img);
        const cleanPng = toPngDataUrl(cleanImg);
        imageCache.set(cleanPng, cleanImg);
        layers.push({
          id: meta.id,
          bone: meta.bone,
          zIndex: meta.zIndex,
          slot: meta.slot,
          piece: meta.piece,
          image: cleanPng,
          imageObj: cleanImg,
        });
      } catch {}
    }
    const preset = toPreset({
      id: 'bare',
      name: '기본 맨몸',
      kind: 'bare',
      canvas: [72, 64],
      layers,
    });
    for (let i = 0; i < preset.layers.length; i++) {
      preset.layers[i].imageObj = layers[i].imageObj;
    }
    defaultBarePreset = preset;
    return defaultBarePreset;
  })();
  return defaultBareLoading;
}

export function mountCharacter(app, model = {}) {
  const basisEl = $('#character-basis');
  const openPresetBtn = $('#character-open-preset');
  const openAnimationBtn = $('#character-open-animation');
  const errorEl = $('#character-error');
  const warningEl = $('#character-warning');
  const bareListEl = $('#character-bare');
  const presetsListEl = $('#character-presets');
  const animListEl = $('#character-animations');
  const motionSelect = $('#play-motion-select');
  const toggleBtn = $('#play-toggle-btn');
  const zoomInBtn = $('#character-zoom-in');
  const zoomOutBtn = $('#character-zoom-out');
  const timeDisplay = $('#play-time-display');
  const canvas = $('#play-canvas');
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });

  const saveBundleBtn = $('#play-save-bundle');
  const checkSkeleton = $('#bundle-check-skeleton');
  const checkAnimation = $('#bundle-check-animation');
  const checkPresets = $('#bundle-check-presets');
  const saveGodotBtn = $('#rig-save-godot');

  let state = normalizeCharacterState();
  let isPlaying = false;
  let currentTime = 0;
  let rafId = 0;
  let lastTimestamp = 0;
  let zoomScale = 4;

  function getBasis() {
    const fromModel = model.getRigBasis?.();
    if (fromModel) return fromModel;
    const proj = model.getProject?.();
    if (proj) return { canvas: proj.canvas, skeletonName: proj.skeletonName, bones: proj.bones, restPose: proj.restPose };
    return { canvas: [72, 64], skeletonName: 'character_skeleton', bones: DEFAULT_BONES, restPose: null };
  }

  function updateBasisUI() {
    if (!basisEl) return;
    const basis = getBasis();
    const name = basis?.skeletonName || 'character_skeleton';
    const isDefault = name === 'character_skeleton' && (!basis.bones || basis.bones.length === 6);
    basisEl.textContent = `기준 뼈대: ${isDefault ? '기본 6개 뼈' : name}`;
  }

  function ensureImages(flattened) {
    for (const item of flattened) {
      const l = item.layer;
      if (!l || typeof l.image !== 'string' || !l.image.startsWith('data:')) continue;
      if (imageCache.has(l.image)) {
        l.imageObj = imageCache.get(l.image);
      } else if (!pendingDecodes.has(l.image)) {
        const url = l.image;
        pendingDecodes.add(url);
        decodeDataUrl(url).then(imgObj => {
          imageCache.set(url, imgObj);
          pendingDecodes.delete(url);
          render();
        }).catch(() => {
          pendingDecodes.delete(url);
        });
      }
    }
  }

  function render() {
    if (!ctx) return;
    const basis = getBasis();
    const bones = (basis.bones && basis.bones.length > 0) ? basis.bones : DEFAULT_BONES;
    const options = characterMotionOptions(state);
    const chosen = options.find(opt => opt.key === state.selectedMotion) || options[0];
    const motion = chosen?.motion || null;
    const duration = motion?.length || 0.8;

    const pose = motion ? poseAt(bones, motion, currentTime) : (basis.restPose || bones);
    const flattened = flattenedCharacterLayers(state);
    ensureImages(flattened);

    const composed = composeStackedLayers(flattened, {
      width: 72,
      height: 64,
      bones: pose,
      restBones: bones,
    });

    // 초록 배경 (3, 192, 55, 255)
    const frameBuf = new Uint8ClampedArray(72 * 64 * 4);
    for (let i = 0; i < frameBuf.length; i += 4) {
      frameBuf[i] = 3;
      frameBuf[i + 1] = 192;
      frameBuf[i + 2] = 55;
      frameBuf[i + 3] = 255;
    }

    const cdata = composed.data;
    for (let i = 0; i < frameBuf.length; i += 4) {
      const alpha = cdata[i + 3];
      if (!alpha) continue;
      if (alpha === 255) {
        frameBuf[i] = cdata[i];
        frameBuf[i + 1] = cdata[i + 1];
        frameBuf[i + 2] = cdata[i + 2];
        frameBuf[i + 3] = 255;
      } else {
        const top = alpha / 255;
        const bot = 1 - top;
        frameBuf[i] = Math.round(cdata[i] * top + 3 * bot);
        frameBuf[i + 1] = Math.round(cdata[i + 1] * top + 192 * bot);
        frameBuf[i + 2] = Math.round(cdata[i + 2] * top + 55 * bot);
        frameBuf[i + 3] = 255;
      }
    }

    ctx.putImageData(new ImageData(frameBuf, 72, 64), 0, 0);

    if (timeDisplay) {
      timeDisplay.textContent = `${currentTime.toFixed(1)}s / ${duration.toFixed(1)}s`;
    }
  }

  function loop(now) {
    if (!isPlaying) return;
    if (!lastTimestamp) lastTimestamp = now;
    const dt = (now - lastTimestamp) / 1000;
    lastTimestamp = now;

    const options = characterMotionOptions(state);
    const chosen = options.find(opt => opt.key === state.selectedMotion) || options[0];
    const motion = chosen?.motion || null;
    const duration = motion?.length || 0.8;

    currentTime += dt;
    if (currentTime >= duration) {
      if (motion && motion.loop === false) {
        currentTime = duration;
        pause();
      } else {
        currentTime = duration > 0 ? (currentTime % duration) : 0;
      }
    }

    render();
    if (isPlaying) {
      rafId = requestAnimationFrame(loop);
    }
  }

  function play() {
    const basis = getBasis();
    const inspect = inspectCharacter(state, basis);
    if (!inspect.compatible) {
      app.toast?.('호환되지 않는 항목이 있어 재생할 수 없습니다');
      return;
    }
    if (isPlaying) return;
    isPlaying = true;
    lastTimestamp = 0;
    if (toggleBtn) toggleBtn.textContent = '⏸ 멈춤';
    rafId = requestAnimationFrame(loop);
  }

  function pause() {
    isPlaying = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (toggleBtn) toggleBtn.textContent = '▶ 재생';
  }

  function refreshUI() {
    updateBasisUI();
    const basis = getBasis();
    const inspect = inspectCharacter(state, basis);

    // 에러 및 경고 표시
    if (!inspect.compatible) {
      pause();
      if (errorEl) {
        errorEl.hidden = false;
        const reasons = [];
        if (inspect.missingBones.length) reasons.push(`현재 뼈대에 없는 뼈: ${inspect.missingBones.join(', ')}`);
        if (inspect.duplicateMotionNames.length) reasons.push(`겹친 움직임 이름: ${inspect.duplicateMotionNames.join(', ')}`);
        errorEl.textContent = reasons.join(' · ');
      }
      if (toggleBtn) toggleBtn.disabled = true;
      if (saveBundleBtn) saveBundleBtn.disabled = true;
      if (saveGodotBtn) saveGodotBtn.disabled = true;
    } else {
      if (errorEl) errorEl.hidden = true;
      if (toggleBtn) toggleBtn.disabled = false;
      if (saveBundleBtn) saveBundleBtn.disabled = false;
      if (saveGodotBtn) saveGodotBtn.disabled = false;
    }

    if (inspect.nameWarnings.length) {
      if (warningEl) {
        warningEl.hidden = false;
        warningEl.textContent = inspect.nameWarnings.join(' · ');
      }
    } else {
      if (warningEl) warningEl.hidden = true;
    }

    // 1. 맨몸 프리셋 렌더링
    if (bareListEl) {
      bareListEl.innerHTML = '';
      const bare = state.barePreset;
      if (bare) {
        const item = document.createElement('div');
        item.className = 'character-item';
        const title = document.createElement('span');
        title.className = 'character-item-title';
        title.textContent = `맨몸: ${bare.name || bare.id}`;
        const badge = document.createElement('span');
        badge.className = 'character-item-badge';
        badge.textContent = 'bare (캐시)';
        item.appendChild(title);
        item.appendChild(badge);
        bareListEl.appendChild(item);
      }
    }

    // 2. 오버레이 프리셋 목록 렌더링
    if (presetsListEl) {
      presetsListEl.innerHTML = '';
      state.loadedPresets.forEach((entry, idx) => {
        const item = document.createElement('div');
        item.className = 'character-item';
        const presetCheck = inspect.presetResults[idx + (state.barePreset ? 1 : 0)];
        if (presetCheck && !presetCheck.compatible) {
          item.classList.add('is-invalid');
        }

        const title = document.createElement('span');
        title.className = 'character-item-title';
        title.textContent = `${entry.preset.name || entry.preset.id}`;

        if (presetCheck && presetCheck.missingBones.length > 0) {
          const miss = document.createElement('span');
          miss.className = 'character-item-missing';
          miss.textContent = `(없는 뼈: ${presetCheck.missingBones.join(', ')})`;
          title.appendChild(document.createTextNode(' '));
          title.appendChild(miss);
        }

        const badge = document.createElement('span');
        badge.className = 'character-item-badge';
        badge.textContent = entry.preset.kind || 'overlay';

        const upBtn = document.createElement('button');
        upBtn.className = 'btn small';
        upBtn.textContent = '▲';
        upBtn.disabled = idx === 0;
        upBtn.addEventListener('click', () => {
          state = moveCharacterPreset(state, idx, -1);
          app.changed?.();
          refreshUI();
        });

        const downBtn = document.createElement('button');
        downBtn.className = 'btn small';
        downBtn.textContent = '▼';
        downBtn.disabled = idx === state.loadedPresets.length - 1;
        downBtn.addEventListener('click', () => {
          state = moveCharacterPreset(state, idx, 1);
          app.changed?.();
          refreshUI();
        });

        const delBtn = document.createElement('button');
        delBtn.className = 'btn small';
        delBtn.textContent = '빼기';
        delBtn.addEventListener('click', () => {
          state = removeCharacterPreset(state, idx);
          app.changed?.();
          refreshUI();
        });

        item.appendChild(title);
        item.appendChild(badge);
        item.appendChild(upBtn);
        item.appendChild(downBtn);
        item.appendChild(delBtn);
        presetsListEl.appendChild(item);
      });
    }

    // 3. 애니메이션 목록 렌더링
    if (animListEl) {
      animListEl.innerHTML = '';
      state.animations.forEach((entry, idx) => {
        const item = document.createElement('div');
        item.className = 'character-item';
        const animCheck = inspect.animationResults[idx];
        if (animCheck && !animCheck.compatible) {
          item.classList.add('is-invalid');
        }

        const title = document.createElement('span');
        title.className = 'character-item-title';
        const mCount = Object.keys(entry.animation.motions || {}).length;
        title.textContent = `${entry.name || entry.animation.skeleton} (${mCount}개 움직임)`;

        if (animCheck && animCheck.allMissingBones.length > 0) {
          const miss = document.createElement('span');
          miss.className = 'character-item-missing';
          miss.textContent = `(없는 뼈: ${animCheck.allMissingBones.join(', ')})`;
          title.appendChild(document.createTextNode(' '));
          title.appendChild(miss);
        }

        const badge = document.createElement('span');
        badge.className = 'character-item-badge';
        badge.textContent = 'anim';

        const delBtn = document.createElement('button');
        delBtn.className = 'btn small';
        delBtn.textContent = '빼기';
        delBtn.addEventListener('click', () => {
          state = removeCharacterAnimation(state, idx);
          app.changed?.();
          refreshUI();
        });

        item.appendChild(title);
        item.appendChild(badge);
        item.appendChild(delBtn);
        animListEl.appendChild(item);
      });
    }

    // 4. 움직임 선택 셀렉트 동기화
    if (motionSelect) {
      const options = characterMotionOptions(state);
      const prevKey = state.selectedMotion;
      motionSelect.innerHTML = '';
      for (const opt of options) {
        const el = document.createElement('option');
        el.value = opt.key;
        el.textContent = opt.label;
        motionSelect.appendChild(el);
      }
      if (options.some(opt => opt.key === prevKey)) {
        motionSelect.value = prevKey;
      } else if (options.length > 0) {
        state.selectedMotion = options[0].key;
        motionSelect.value = options[0].key;
      } else {
        state.selectedMotion = '';
      }
    }

    render();
  }

  // 프리셋 불러오기
  openPresetBtn?.addEventListener('click', async () => {
    try {
      const [file] = await pickFiles({ accept: '.json,application/json,text/plain' });
      if (!file) return;
      const json = JSON.parse(await file.text());
      const preset = parsePreset(json);
      state = addCharacterPreset(state, preset, file.name);
      app.changed?.();
      refreshUI();
      app.toast?.(`프리셋 「${preset.name || preset.id}」을 불러왔습니다`);
    } catch (err) {
      app.toast?.(err.message || '프리셋을 열 수 없습니다');
    }
  });

  // 애니메이션 불러오기
  openAnimationBtn?.addEventListener('click', async () => {
    try {
      const [file] = await pickFiles({ accept: '.json,application/json,text/plain' });
      if (!file) return;
      const json = JSON.parse(await file.text());
      const animation = parseAnimation(json);
      state = addCharacterAnimation(state, animation, file.name);
      app.changed?.();
      refreshUI();
      app.toast?.(`애니메이션 「${file.name}」을 불러왔습니다`);
    } catch (err) {
      app.toast?.(err.message || '애니메이션을 열 수 없습니다');
    }
  });

  // 움직임 변경
  motionSelect?.addEventListener('change', () => {
    state.selectedMotion = motionSelect.value;
    currentTime = 0;
    app.changed?.();
    render();
  });

  // 재생 토글
  toggleBtn?.addEventListener('click', () => {
    if (isPlaying) pause();
    else play();
  });

  // 확대 축소 (+, −)
  zoomInBtn?.addEventListener('click', () => {
    if (zoomScale < 8) {
      zoomScale++;
      if (canvas) {
        canvas.style.width = `${72 * zoomScale}px`;
        canvas.style.height = `${64 * zoomScale}px`;
      }
    }
  });

  zoomOutBtn?.addEventListener('click', () => {
    if (zoomScale > 2) {
      zoomScale--;
      if (canvas) {
        canvas.style.width = `${72 * zoomScale}px`;
        canvas.style.height = `${64 * zoomScale}px`;
      }
    }
  });

  // 통합 묶음 ZIP
  saveBundleBtn?.addEventListener('click', async () => {
    try {
      const isSkel = Boolean(checkSkeleton?.checked);
      const isAnim = Boolean(checkAnimation?.checked);
      const isPresets = Boolean(checkPresets?.checked);

      if (!isSkel && !isAnim && !isPresets) {
        app.toast?.('내보낼 항목을 하나 이상 선택해 주세요');
        return;
      }

      const basis = getBasis();
      const input = characterBundleInput(state, basis);
      const bundle = makeBundle({
        skeleton: input.skeleton,
        animation: input.animation,
        presets: input.presets,
        selected: {
          skeleton: isSkel,
          animation: isAnim,
          presets: isPresets,
        },
        canvas: input.canvas,
      });

      const result = await saveFile('dotfactory-bundle.zip', new Blob([bundle.bytes], { type: 'application/zip' }));
      if (result !== 'cancelled') {
        app.toast?.('「dotfactory-bundle.zip」을 만들었습니다');
      }
    } catch (err) {
      app.toast?.(err.message || '통합 묶음 ZIP을 만들 수 없습니다');
    }
  });

  // 고도용 ZIP
  saveGodotBtn?.addEventListener('click', async () => {
    try {
      const basis = getBasis();
      const proj = characterGodotProject(state, basis);
      const made = makeGodotExport(proj);
      const result = await saveFile('dotfactory-godot.zip', new Blob([made.bytes], { type: 'application/zip' }));
      if (result !== 'cancelled') {
        app.toast?.('「dotfactory-godot.zip」을 만들었습니다');
      }
    } catch (err) {
      app.toast?.(err.message || '고도용 ZIP을 만들 수 없습니다');
    }
  });

  // 초기 맨몸 로드
  if (!state.barePreset) {
    loadDefaultBare().then(bare => {
      if (!state.barePreset) {
        state.barePreset = bare;
        refreshUI();
      }
    }).catch(() => {});
  }

  return {
    shown() {
      refreshUI();
      currentTime = 0;
      render();
    },
    hide() {
      pause();
    },
    snapshot() {
      return {
        barePreset: state.barePreset,
        loadedPresets: state.loadedPresets,
        animations: state.animations,
        selectedMotion: state.selectedMotion,
      };
    },
    async restore(saved) {
      state = normalizeCharacterState(saved);
      if (!state.barePreset) {
        const bare = await loadDefaultBare().catch(() => null);
        if (bare && !state.barePreset) state.barePreset = bare;
      }
      refreshUI();
    },
    getPresetStack() {
      return {
        barePreset: state.barePreset,
        overlayPresets: state.loadedPresets.map(entry => entry.preset),
      };
    },
  };
}
