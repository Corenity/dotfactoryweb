// site/js/character-play-view.js — 캐릭터 > 플레이 서브탭 화면입니다.
// 뼈 + 고른 움직임 + 프리셋(맨몸·오버레이) 합성 재생 및 고도 통합 번들 ZIP 부분 내보내기를 담당합니다.
import { DEFAULT_BONES } from './core/rig.js';
import { poseAt } from './core/motion.js';
import { toPreset } from './core/preset.js';
import { DEFAULT_BARE_LAYERS_META, flattenPresetStack, composeStackedLayers } from './core/preset-stack.js';
import { toSkeleton } from './core/skeleton.js';
import { toAnimation } from './core/animation.js';
import { makeBundle } from './core/godot-export.js';
import { makeBackgroundTransparent } from './core/background.js';
import { readImageFile, toPngDataUrl, saveFile } from './io.js';

const $ = sel => document.querySelector(sel);

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

// 1. 기본 맨몸 에셋 비동기 로더 (site/assets/bare/ 영문 8장)
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
        layers.push({
          id: meta.id,
          bone: meta.bone,
          zIndex: meta.zIndex,
          slot: meta.slot,
          piece: meta.piece,
          image: cleanPng,
          imageObj: cleanImg,
        });
      } catch {
        // 읽기 실패 시 건너뜀
      }
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

export function mountCharacterPlay(app, model) {
  const canvas = $('#play-canvas');
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });
  const toggleBtn = $('#play-toggle-btn');
  const motionSelect = $('#play-motion-select');
  const timeDisplay = $('#play-time-display');
  const saveBundleBtn = $('#play-save-bundle');
  const checkSkeleton = $('#bundle-check-skeleton');
  const checkAnimation = $('#bundle-check-animation');
  const checkPresets = $('#bundle-check-presets');

  let isPlaying = false;
  let currentTime = 0;
  let currentMotionName = 'walk';
  let rafId = 0;
  let lastTimestamp = 0;

  // 비동기로 기본 맨몸 프리로드 시동
  loadDefaultBare().then(() => {
    render();
  }).catch(() => {});

  function getEffectiveBare() {
    const stack = model.getPresetStack?.();
    if (stack?.barePreset && stack.barePreset.layers && stack.barePreset.layers.length > 0) {
      return stack.barePreset;
    }
    if (stack?.currentPreset?.kind === 'bare' && stack.currentPreset.layers && stack.currentPreset.layers.length > 0) {
      return stack.currentPreset;
    }
    return defaultBarePreset;
  }

  function getActivePresets() {
    const stack = model.getPresetStack?.();
    const effectiveBare = getEffectiveBare();
    const presets = [];
    if (effectiveBare) presets.push(effectiveBare);

    for (const p of stack?.overlayPresets || []) {
      if (!presets.some(x => x.id === p.id)) presets.push(p);
    }
    if (stack?.currentPreset && stack.currentPreset !== effectiveBare && stack.currentPreset.layers?.length > 0 && !presets.some(x => x.id === stack.currentPreset.id)) {
      presets.push(stack.currentPreset);
    }
    return presets;
  }

  function ensureLayerImages(flattened) {
    for (const item of flattened) {
      const l = item.layer;
      if (l && !l.imageObj && typeof l.image === 'string' && l.image.startsWith('data:')) {
        decodeDataUrl(l.image).then(imgObj => {
          l.imageObj = imgObj;
          render();
        }).catch(() => {});
      }
    }
  }

  function getFlattenedLayers() {
    const stack = model.getPresetStack?.();
    const effectiveBare = getEffectiveBare();
    const overlays = (stack?.overlayPresets || []).slice();
    if (stack?.currentPreset && stack.currentPreset !== effectiveBare && stack.currentPreset.kind !== 'bare' && !overlays.some(x => x.id === stack.currentPreset.id)) {
      overlays.push(stack.currentPreset);
    }
    const flattened = flattenPresetStack(effectiveBare, overlays);
    ensureLayerImages(flattened);
    return flattened;
  }

  function syncMotions() {
    if (!motionSelect) return;
    const proj = model.getProject();
    const anims = proj.animations || {};
    const names = Object.keys(anims);
    const prev = currentMotionName;

    motionSelect.innerHTML = '';
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      motionSelect.appendChild(opt);
    }

    if (names.includes(prev)) {
      currentMotionName = prev;
      motionSelect.value = prev;
    } else if (names.length > 0) {
      currentMotionName = names[0];
      motionSelect.value = names[0];
    } else {
      currentMotionName = '';
    }
  }

  function render() {
    if (!ctx) return;
    const proj = model.getProject();
    const bones = (proj.bones && proj.bones.length > 0) ? proj.bones : DEFAULT_BONES;
    const anim = proj.animations?.[currentMotionName];
    const duration = anim?.length || 0.8;

    const pose = anim ? poseAt(bones, anim, currentTime) : bones;
    const flattened = getFlattenedLayers();
    const composed = composeStackedLayers(flattened, {
      width: 72,
      height: 64,
      bones: pose,
      restBones: bones,
    });

    // 화면 배경은 초록(3, 192, 55, 255)
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

    const proj = model.getProject();
    const anim = proj.animations?.[currentMotionName];
    const duration = anim?.length || 0.8;

    currentTime += dt;
    if (currentTime >= duration) {
      if (anim && anim.loop === false) {
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

  toggleBtn?.addEventListener('click', () => {
    if (isPlaying) pause();
    else play();
  });

  motionSelect?.addEventListener('change', () => {
    currentMotionName = motionSelect.value;
    currentTime = 0;
    render();
  });

  saveBundleBtn?.addEventListener('click', async () => {
    try {
      const isSkel = Boolean(checkSkeleton?.checked);
      const isAnim = Boolean(checkAnimation?.checked);
      const isPresets = Boolean(checkPresets?.checked);

      if (!isSkel && !isAnim && !isPresets) {
        app.toast('내보낼 항목을 하나 이상 선택해 주세요');
        return;
      }

      if (!defaultBarePreset && (!model.getPresetStack?.()?.barePreset?.layers?.length)) {
        await loadDefaultBare().catch(() => {});
      }

      const proj = model.getProject();
      const skeleton = toSkeleton({ canvas: proj.canvas, bones: proj.bones });
      const animation = toAnimation({
        skeleton: 'character_skeleton',
        bones: (proj.bones || []).map(b => b.name),
        motions: proj.animations || {},
      });
      const presets = getActivePresets();

      const bundle = makeBundle({
        skeleton,
        animation,
        presets,
        selected: {
          skeleton: isSkel,
          animation: isAnim,
          presets: isPresets,
        },
        canvas: proj.canvas,
      });

      const result = await saveFile('dotfactory-bundle.zip', new Blob([bundle.bytes], { type: 'application/zip' }));
      if (result !== 'cancelled') {
        app.toast('「dotfactory-bundle.zip」을 만들었습니다');
      }
    } catch (err) {
      app.toast(err.message || '통합 묶음 ZIP을 만들 수 없습니다');
    }
  });

  return {
    async show() {
      syncMotions();
      currentTime = 0;
      if (!defaultBarePreset && (!model.getPresetStack?.()?.barePreset?.layers?.length)) {
        await loadDefaultBare().catch(() => {});
      }
      render();
    },
    hide() {
      pause();
    },
  };
}
