// site/js/preset-view.js — 캐릭터 > 프리셋 만들기 서브탭 화면입니다.
// 맨몸 프리셋 상시 캐싱, 층(zIndex) 순서 덧그리기, 프리셋 저장/열기를 다룹니다.
import { toPreset, parsePreset } from './core/preset.js';
import { DEFAULT_BARE_LAYERS_META, flattenPresetStack, composeStackedLayers } from './core/preset-stack.js';
import { makeBackgroundTransparent } from './core/background.js';
import { KEY, toHex } from './core/paint.js';
import { defaultZIndex, defaultBoneFor, DEFAULT_BONES } from './core/rig.js';
import { pickFiles, readImageFile, toPngDataUrl, saveJson, savePng, baseName, drawPixels } from './io.js';

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

function attachImageObjs(targetPreset, sourceLayers) {
  if (!targetPreset || !targetPreset.layers || !sourceLayers) return targetPreset;
  const map = new Map();
  for (const l of sourceLayers) {
    if (l && l.id && l.imageObj) map.set(l.id, l.imageObj);
  }
  for (const layer of targetPreset.layers) {
    if (!layer.imageObj && map.has(layer.id)) {
      layer.imageObj = map.get(layer.id);
    }
  }
  return targetPreset;
}

export function mountPreset(app) {
  let barePreset = null;
  let overlayPresets = [];
  let currentPreset = toPreset({
    id: 'bare',
    name: '기본 맨몸',
    kind: 'bare',
    canvas: [72, 64],
    layers: [],
  });

  const canvas = $('#preset-canvas');
  const idInput = $('#preset-id');
  const nameInput = $('#preset-name');
  const kindSelect = $('#preset-kind');
  const layerListEl = $('#preset-layer-list');
  const overlayListEl = $('#preset-overlay-list');

  // 1. 기본 맨몸 에셋 비동기 로더 (site/assets/bare/ 영문 8장)
  let defaultBareLoading = null;
  async function loadDefaultBarePreset() {
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
          // 로드 실패 시 건너뜀
        }
      }
      const preset = toPreset({
        id: 'bare',
        name: '기본 맨몸',
        kind: 'bare',
        canvas: [72, 64],
        layers,
      });
      attachImageObjs(preset, layers);
      return preset;
    })();
    return defaultBareLoading;
  }

  // 마운트 시 기본 맨몸 비동기 프리로드 시작
  loadDefaultBarePreset().then(p => {
    if (!barePreset) {
      barePreset = p;
      if (currentPreset && (!currentPreset.layers || currentPreset.layers.length === 0) && currentPreset.kind === 'bare') {
        currentPreset = toPreset(p);
        attachImageObjs(currentPreset, p.layers);
      }
    }
  }).catch(() => {});

  // 2. 캔버스 렌더링
  async function renderCanvas() {
    if (!canvas) return;
    const effectiveBare = (currentPreset.kind === 'bare') ? currentPreset : barePreset;
    const effectiveOverlays = (currentPreset.kind === 'bare')
      ? overlayPresets
      : [...overlayPresets.filter(p => p.id !== currentPreset.id), currentPreset];

    const flattened = flattenPresetStack(effectiveBare, effectiveOverlays);

    // imageObj 가 없는 레이어는 Data URL 에서 이미지 디코딩
    for (const item of flattened) {
      const layer = item.layer;
      if (!layer.imageObj && layer.image) {
        try {
          layer.imageObj = await decodeDataUrl(layer.image);
        } catch {}
      }
    }

    const composed = composeStackedLayers(flattened, { width: 72, height: 64 });
    drawPixels(canvas, composed, 3, toHex(KEY));
  }

  // 3. UI 갱신 (메타 필드, 레이어 목록, 오버레이 목록)
  function syncUI() {
    if (idInput && idInput.value !== currentPreset.id) idInput.value = currentPreset.id;
    if (nameInput && nameInput.value !== currentPreset.name) nameInput.value = currentPreset.name;
    if (kindSelect && kindSelect.value !== currentPreset.kind) kindSelect.value = currentPreset.kind;

    renderLayersList();
    renderOverlaysList();
    renderCanvas();
  }

  function renderLayersList() {
    if (!layerListEl) return;
    layerListEl.innerHTML = '';

    if (!currentPreset.layers || currentPreset.layers.length === 0) {
      layerListEl.innerHTML = '<p class="hint" style="text-align:center;">등록된 레이어가 없습니다</p>';
      return;
    }

    currentPreset.layers.forEach((layer, idx) => {
      const item = document.createElement('div');
      item.className = 'preset-layer-item';

      const thumb = document.createElement('img');
      thumb.src = layer.image;
      thumb.alt = layer.id;
      item.appendChild(thumb);

      const info = document.createElement('div');
      info.className = 'layer-info';

      const idSpan = document.createElement('span');
      idSpan.className = 'layer-id';
      idSpan.textContent = layer.id;
      info.appendChild(idSpan);

      // 뼈 선택
      const boneSelect = document.createElement('select');
      DEFAULT_BONES.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.name;
        opt.textContent = b.name;
        if (b.name === layer.bone) opt.selected = true;
        boneSelect.appendChild(opt);
      });
      boneSelect.addEventListener('change', () => {
        layer.bone = boneSelect.value;
        renderCanvas();
        app.changed();
      });
      info.appendChild(boneSelect);

      // 층(zIndex) 입력
      const zInput = document.createElement('input');
      zInput.type = 'number';
      zInput.value = layer.zIndex;
      zInput.min = '-1000';
      zInput.max = '1000';
      zInput.step = '1';
      zInput.addEventListener('change', () => {
        const val = parseInt(zInput.value, 10);
        layer.zIndex = Number.isFinite(val) ? val : 0;
        renderCanvas();
        app.changed();
      });
      info.appendChild(zInput);

      item.appendChild(info);

      // 삭제 단추
      const delBtn = document.createElement('button');
      delBtn.className = 'btn small';
      delBtn.textContent = '삭제';
      delBtn.addEventListener('click', () => {
        currentPreset.layers.splice(idx, 1);
        syncUI();
        app.changed();
      });
      item.appendChild(delBtn);

      layerListEl.appendChild(item);
    });
  }

  function renderOverlaysList() {
    if (!overlayListEl) return;
    overlayListEl.innerHTML = '';

    if (!overlayPresets || overlayPresets.length === 0) {
      overlayListEl.innerHTML = '<p class="hint" style="text-align:center;">얹힌 오버레이 프리셋이 없습니다</p>';
      return;
    }

    overlayPresets.forEach((preset, idx) => {
      const item = document.createElement('div');
      item.className = 'preset-overlay-item';

      const title = document.createElement('span');
      title.className = 'overlay-title';
      title.textContent = `${preset.name} (${preset.id})`;
      item.appendChild(title);

      const badge = document.createElement('span');
      badge.className = 'overlay-badge';
      badge.textContent = preset.kind;
      item.appendChild(badge);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn small';
      delBtn.textContent = '빼기';
      delBtn.addEventListener('click', () => {
        overlayPresets.splice(idx, 1);
        renderOverlaysList();
        renderCanvas();
        app.changed();
      });
      item.appendChild(delBtn);

      overlayListEl.appendChild(item);
    });
  }

  // 4. 이벤트 바인딩
  function bindEvents() {
    // 식별자 변경
    idInput?.addEventListener('input', () => {
      currentPreset.id = idInput.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'preset';
      app.changed();
    });

    // 이름 변경
    nameInput?.addEventListener('input', () => {
      currentPreset.name = nameInput.value.trim() || '새 프리셋';
      app.changed();
    });

    // 종류 변경
    kindSelect?.addEventListener('change', () => {
      const newKind = kindSelect.value;
      currentPreset.kind = newKind;
      // 맨몸으로 변경 시 현재 프리셋이 맨몸 캐시가 됨
      if (newKind === 'bare') {
        barePreset = currentPreset;
      }
      syncUI();
      app.changed();
    });

    // 기본 맨몸 불러오기 단추
    $('#preset-load-default')?.addEventListener('click', async () => {
      try {
        defaultBareLoading = null;
        const def = await loadDefaultBarePreset();
        barePreset = def;
        if (currentPreset.kind === 'bare') {
          currentPreset = toPreset(def);
          attachImageObjs(currentPreset, def.layers);
        }
        syncUI();
        await renderCanvas();
        app.toast('기본 맨몸 프리셋(8조각)을 불러왔습니다');
        app.changed();
      } catch (err) {
        app.toast('기본 맨몸을 불러오지 못했습니다: ' + err.message);
      }
    });

    // 프리셋 열기 (JSON)
    $('#preset-open-json')?.addEventListener('click', async () => {
      try {
        const [file] = await pickFiles({ accept: '.json,application/json,text/plain' });
        if (!file) return;
        const text = await file.text();
        let parsed;
        try {
          parsed = parsePreset(JSON.parse(text));
        } catch (e) {
          app.toast('올바른 도트 공장 프리셋 파일이 아닙니다');
          return;
        }

        currentPreset = parsed;
        if (parsed.kind === 'bare') {
          barePreset = parsed;
        }
        syncUI();
        await renderCanvas();
        app.toast(`프리셋 「${parsed.name}」을 열었습니다`);
        app.changed();
      } catch (err) {
        app.toast('프리셋 파일을 열 수 없습니다');
      }
    });

    // 프리셋 저장 (JSON)
    $('#preset-save-json')?.addEventListener('click', () => {
      try {
        const presetObj = toPreset(currentPreset);
        saveJson(`${presetObj.id || 'preset'}.json`, presetObj);
        app.toast(`「${presetObj.id}.json」으로 저장했습니다`);
      } catch (err) {
        app.toast('프리셋 저장 실패: ' + err.message);
      }
    });

    // 그림 받기 (합성된 72x64 투명 PNG)
    $('#preset-save-png')?.addEventListener('click', async () => {
      try {
        const effectiveBare = (currentPreset.kind === 'bare') ? currentPreset : barePreset;
        const effectiveOverlays = (currentPreset.kind === 'bare')
          ? overlayPresets
          : [...overlayPresets.filter(p => p.id !== currentPreset.id), currentPreset];

        const flattened = flattenPresetStack(effectiveBare, effectiveOverlays);
        for (const item of flattened) {
          const layer = item.layer;
          if (!layer.imageObj && layer.image) {
            try { layer.imageObj = await decodeDataUrl(layer.image); } catch {}
          }
        }

        const composed = composeStackedLayers(flattened, { width: 72, height: 64 });
        savePng(`${currentPreset.id || 'character'}.png`, composed);
        app.toast(`투명 배경 그림 「${currentPreset.id}.png」을 내려받았습니다`);
      } catch (err) {
        app.toast('그림 내려받기 실패: ' + err.message);
      }
    });

    // 자르기 조각에서 넣기
    $('#preset-add-piece')?.addEventListener('click', async () => {
      try {
        const pieces = app.getPieces?.() || [];
        if (!pieces || pieces.length === 0) {
          app.toast('자르기 탭에서 먼저 조각을 만들어 주세요');
          return;
        }

        const piece = pieces[pieces.length - 1];
        const img = piece.image || (piece.png ? await decodeDataUrl(piece.png) : null);
        if (!img) {
          app.toast('조각 그림을 읽을 수 없습니다');
          return;
        }

        const { image: cleanImg } = makeBackgroundTransparent(img);
        const cleanPng = toPngDataUrl(cleanImg);
        const pieceId = `${piece.slot || currentPreset.kind}_${piece.piece || piece.name || 'piece'}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        const bone = piece.bone || defaultBoneFor(piece.slot, piece.piece);
        const zIndex = piece.zIndex != null ? piece.zIndex : defaultZIndex(piece.slot, piece.piece);

        const existingIdx = currentPreset.layers.findIndex(l => l.id === pieceId);
        const newLayer = {
          id: pieceId,
          bone,
          zIndex,
          slot: piece.slot || currentPreset.kind,
          piece: piece.piece || pieceId,
          image: cleanPng,
          imageObj: cleanImg,
        };

        if (existingIdx >= 0) {
          currentPreset.layers[existingIdx] = newLayer;
        } else {
          currentPreset.layers.push(newLayer);
        }

        syncUI();
        await renderCanvas();
        app.toast(`자르기 조각 「${pieceId}」을 프리셋에 넣었습니다`);
        app.changed();
      } catch (err) {
        app.toast('조각 넣기 실패: ' + err.message);
      }
    });

    // 그림 파일 올리기
    $('#preset-add-file')?.addEventListener('click', async () => {
      try {
        const [file] = await pickFiles({ accept: 'image/png,image/*' });
        if (!file) return;
        const rawImg = await readImageFile(file);
        const { image: cleanImg } = makeBackgroundTransparent(rawImg);
        const cleanPng = toPngDataUrl(cleanImg);

        const base = baseName(file.name).toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'layer';
        const layerId = `${currentPreset.kind}_${base}`;
        const bone = defaultBoneFor(currentPreset.kind, base);
        const zIndex = defaultZIndex(currentPreset.kind, base);

        const existingIdx = currentPreset.layers.findIndex(l => l.id === layerId);
        const newLayer = {
          id: layerId,
          bone,
          zIndex,
          slot: currentPreset.kind,
          piece: base,
          image: cleanPng,
          imageObj: cleanImg,
        };

        if (existingIdx >= 0) {
          currentPreset.layers[existingIdx] = newLayer;
        } else {
          currentPreset.layers.push(newLayer);
        }

        syncUI();
        await renderCanvas();
        app.toast(`「${file.name}」 그림을 투명화하여 넣었습니다`);
        app.changed();
      } catch (err) {
        app.toast('그림 올리기 실패: ' + err.message);
      }
    });

    // 프리셋 얹기 (오버레이)
    $('#preset-add-overlay')?.addEventListener('click', async () => {
      try {
        const [file] = await pickFiles({ accept: '.json,application/json,text/plain' });
        if (!file) return;
        const text = await file.text();
        let parsed;
        try {
          parsed = parsePreset(JSON.parse(text));
        } catch {
          app.toast('올바른 도트 공장 프리셋 파일이 아닙니다');
          return;
        }

        overlayPresets = overlayPresets.filter(p => p.id !== parsed.id);
        overlayPresets.push(parsed);
        renderOverlaysList();
        await renderCanvas();
        app.toast(`오버레이 프리셋 「${parsed.name}」을 얹었습니다`);
        app.changed();
      } catch (err) {
        app.toast('오버레이 추가 실패: ' + err.message);
      }
    });

    // 오버레이 모두 빼기
    $('#preset-clear-overlays')?.addEventListener('click', async () => {
      overlayPresets = [];
      renderOverlaysList();
      await renderCanvas();
      app.toast('오버레이 프리셋을 모두 뺐습니다');
      app.changed();
    });
  }

  bindEvents();

  return {
    async shown() {
      if (!barePreset) {
        try {
          barePreset = await loadDefaultBarePreset();
          if (currentPreset.kind === 'bare' && currentPreset.layers.length === 0) {
            currentPreset = toPreset(barePreset);
            attachImageObjs(currentPreset, barePreset.layers);
          }
        } catch {}
      }
      syncUI();
      await renderCanvas();
    },
    snapshot() {
      return {
        currentPreset: toPreset(currentPreset),
        barePreset: barePreset ? toPreset(barePreset) : null,
        overlayPresets: (overlayPresets || []).map(toPreset),
      };
    },
    async restore(saved) {
      if (!saved || typeof saved !== 'object') {
        try {
          barePreset = await loadDefaultBarePreset();
          currentPreset = toPreset(barePreset);
          attachImageObjs(currentPreset, barePreset.layers);
        } catch {}
        syncUI();
        await renderCanvas();
        return;
      }

      try {
        if (saved.barePreset) {
          barePreset = parsePreset(saved.barePreset);
        } else {
          barePreset = await loadDefaultBarePreset();
        }

        if (saved.currentPreset) {
          currentPreset = parsePreset(saved.currentPreset);
        } else if (barePreset) {
          currentPreset = toPreset(barePreset);
          attachImageObjs(currentPreset, barePreset.layers);
        }

        if (Array.isArray(saved.overlayPresets)) {
          overlayPresets = saved.overlayPresets.map(parsePreset);
        } else {
          overlayPresets = [];
        }
      } catch {
        try {
          barePreset = await loadDefaultBarePreset();
          currentPreset = toPreset(barePreset);
          attachImageObjs(currentPreset, barePreset.layers);
        } catch {}
      }

      syncUI();
      await renderCanvas();
    },
    getPresetStack() {
      const cloneWithImages = p => {
        if (!p) return null;
        const cloned = toPreset(p);
        attachImageObjs(cloned, p.layers);
        return cloned;
      };
      return {
        barePreset: cloneWithImages(barePreset),
        currentPreset: cloneWithImages(currentPreset),
        overlayPresets: (overlayPresets || []).map(cloneWithImages),
      };
    },
  };
}
