// site/js/slice-view.js — 색 영역 자르기 화면 총괄 모듈
import { CURRENT_PROFILE } from './core/profile.js';
import { dropKey, KEY, toHex } from './core/paint.js';
import { SliceHistory, cloneSliceState } from './core/slice-history.js';
import {
  REGION_PALETTE,
  regionDotAction,
  createRegionSliceState,
  cloneRegionSliceState,
  addRegion,
  removeRegion,
  recolorRegion,
  paintCell,
  eraseCell,
  sliceByRegions,
  exportRegionConfig,
  importRegionConfig,
  shouldReinitRegionSlice,
} from './core/region-slice.js';
import { createStoredZip } from './core/zip.js';
import { toSliceLibraryItem } from './core/slice-library.js';
import { pickFiles, readImageFile, readDataUrl, toPngDataUrl, saveFile, savePng, baseName, drawPixels } from './io.js';
import { mountRigSlice } from './rig-slice-view.js';

const $ = sel => document.querySelector(sel);

export function mountSlice(app) {
  let [width, height] = CURRENT_PROFILE.canvas;
  let baseImage = null;
  let baseTitle = '그림';
  let pieces = [];

  let regionState = createRegionSliceState(width, height);
  let selectedColor = null;
  const visibleRegions = new Set();
  let activeTool = 'brush';
  let brushSize = 1;

  const history = new SliceHistory();
  const undoButton = $('#slice-undo');
  const redoButton = $('#slice-redo');

  let strokeBeforeState = null;
  let canvasView = null;
  let activePopover = null;

  function closeColorPicker() {
    if (activePopover) {
      if (activePopover.cleanup) activePopover.cleanup();
      activePopover.el.remove();
      activePopover = null;
    }
  }

  function autoSaveKey() {
    const profileId = CURRENT_PROFILE?.id || 'project-c';
    return `dotfactory-web/slice-regions-1/${profileId}`;
  }

  function saveAutosave() {
    try {
      if (typeof localStorage === 'undefined') return;
      const exported = exportRegionConfig(regionState);
      localStorage.setItem(autoSaveKey(), JSON.stringify(exported));
    } catch {
      // 스토리지 제한 등은 무시
    }
  }

  function restoreAutosave() {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(autoSaveKey());
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const restored = importRegionConfig(parsed, [width, height]);
      regionState = restored;
      for (const c of regionState.regions) visibleRegions.add(c);
      if (regionState.regions.length > 0 && !selectedColor) {
        selectedColor = regionState.regions[0];
      }
    } catch {
      // 형식 불일치 등은 건너뜀
    }
  }

  function historySnapshot() {
    return cloneSliceState({
      canvas: [width, height],
      baseTitle,
      baseImage,
      pieces,
      regionState,
      selectedColor,
    });
  }

  function updateUndoRedo() {
    if (undoButton) undoButton.disabled = !history.canUndo;
    if (redoButton) redoButton.disabled = !history.canRedo;
  }

  function recordChange(before) {
    if (history.push(before, historySnapshot())) {
      updateUndoRedo();
      saveAutosave();
      app.changed();
    }
  }

  function applyHistory(value) {
    if (!value) return;
    closeColorPicker();
    const needReinit = shouldReinitRegionSlice(baseImage, value.baseImage);
    const prevRegions = new Set(regionState.regions);
    [width, height] = value.canvas;
    baseTitle = value.baseTitle;
    baseImage = value.baseImage;
    pieces = value.pieces || [];
    regionState = cloneRegionSliceState(value.regionState);
    selectedColor = value.selectedColor;

    for (const c of regionState.regions) {
      if (!prevRegions.has(c)) {
        visibleRegions.add(c);
      }
    }
    for (const c of Array.from(visibleRegions)) {
      if (!regionState.regions.includes(c)) {
        visibleRegions.delete(c);
      }
    }

    if (selectedColor && !regionState.regions.includes(selectedColor)) {
      selectedColor = regionState.regions[0] || null;
    }

    syncViews();
    renderRegionsList();
    renderPiecesList();
    if (needReinit) canvasView.fit();
    updateUndoRedo();
    saveAutosave();
    app.changed();
  }

  function syncViews() {
    canvasView.sync();
    canvasView.render();
  }

  function setBaseImage(image, title = '그림') {
    baseImage = image;
    baseTitle = baseName(title);
    width = image.width;
    height = image.height;
    if (regionState.width !== width || regionState.height !== height) {
      regionState = createRegionSliceState(width, height);
      selectedColor = null;
      visibleRegions.clear();
    }
    syncViews();
    renderRegionsList();
    canvasView.fit();
  }

  function renderRegionsList() {
    closeColorPicker();
    const list = $('#slice-regions-list');
    if (!list) return;

    const addBtn = $('#slice-add-region');

    // 기존 영역 카드와 힌트 메시지만 제거하여 + 영역 더하기 단추는 보존
    list.querySelectorAll('.slice-region-card, .slice-region-hint').forEach(el => el.remove());

    if (regionState.regions.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'hint slice-region-hint';
      hint.textContent = '지정된 색 영역이 없습니다. 「+ 영역 더하기」를 누르세요.';
      if (addBtn) {
        list.insertBefore(hint, addBtn);
      } else {
        list.appendChild(hint);
      }
      return;
    }

    regionState.regions.forEach(color => {
      const isSelected = selectedColor === color;
      const isVisible = visibleRegions.has(color);

      const card = document.createElement('div');
      card.className = `slice-region-card${isSelected ? ' selected' : ''}`;
      card.setAttribute('role', 'listitem');
      card.setAttribute('aria-selected', String(isSelected));
      card.title = `#${color}`;
      card.setAttribute('aria-label', `색 영역 #${color}`);

      const dotBtn = document.createElement('button');
      dotBtn.type = 'button';
      dotBtn.className = 'slice-region-dot-btn';
      dotBtn.setAttribute('aria-label', isSelected ? `#${color} 색상 변경` : `#${color} 영역 선택`);
      dotBtn.title = isSelected ? '색상 변경' : '영역 선택';

      const dot = document.createElement('span');
      dot.className = 'slice-region-dot';
      dot.style.background = `#${color}`;
      dotBtn.appendChild(dot);

      dotBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (regionDotAction(selectedColor, color) === 'select') {
          closeColorPicker();
          selectedColor = color;
          visibleRegions.add(color);
          renderRegionsList();
          canvasView.drawOverlay();
          return;
        }
        if (activePopover && activePopover.color === color) {
          closeColorPicker();
          return;
        }
        closeColorPicker();

        const availableColors = REGION_PALETTE.filter(c => !regionState.regions.includes(c));
        if (availableColors.length === 0) {
          app.toast('바꿀 수 있는 색상이 없습니다');
          return;
        }

        const popover = document.createElement('div');
        popover.className = 'slice-color-popover';
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', '영역 색상 선택');

        availableColors.forEach(newColor => {
          const itemBtn = document.createElement('button');
          itemBtn.type = 'button';
          itemBtn.className = 'slice-color-item';
          itemBtn.style.background = `#${newColor}`;
          itemBtn.setAttribute('aria-label', `#${newColor}`);
          itemBtn.title = `#${newColor}`;

          itemBtn.addEventListener('click', ev => {
            ev.stopPropagation();
            closeColorPicker();
            const before = historySnapshot();
            recolorRegion(regionState, color, newColor);

            if (selectedColor === color) {
              selectedColor = newColor;
            }
            if (visibleRegions.has(color)) {
              visibleRegions.delete(color);
              visibleRegions.add(newColor);
            }

            renderRegionsList();
            canvasView.drawOverlay();
            recordChange(before);
            app.toast(`영역 색을 #${newColor}(으)로 바꿨습니다`);
          });

          popover.appendChild(itemBtn);
        });

        list.insertAdjacentElement('afterend', popover);

        const onDocClick = ev => {
          if (!card.contains(ev.target) && !popover.contains(ev.target)) {
            closeColorPicker();
          }
        };
        const onKeyDown = ev => {
          if (ev.key === 'Escape') {
            closeColorPicker();
          }
        };
        setTimeout(() => {
          document.addEventListener('pointerdown', onDocClick);
          document.addEventListener('keydown', onKeyDown);
        }, 0);

        activePopover = {
          color,
          el: popover,
          cleanup: () => {
            document.removeEventListener('pointerdown', onDocClick);
            document.removeEventListener('keydown', onKeyDown);
          },
        };
      });

      const name = document.createElement('span');
      name.className = 'slice-region-name';
      name.textContent = color;

      const visBtn = document.createElement('button');
      visBtn.type = 'button';
      visBtn.className = 'btn icon slice-region-vis';
      visBtn.setAttribute('aria-pressed', String(isVisible));
      visBtn.setAttribute('aria-label', `${color} ${isVisible ? '숨기기' : '보이기'}`);
      visBtn.title = isVisible ? '숨기기' : '보이기';
      visBtn.innerHTML = isVisible
        ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>'
        : '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" fill="none" stroke="currentColor" stroke-width="2"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2"/></svg>';

      visBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (visibleRegions.has(color)) {
          visibleRegions.delete(color);
        } else {
          visibleRegions.add(color);
        }
        renderRegionsList();
        canvasView.drawOverlay();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn icon slice-region-del danger';
      delBtn.setAttribute('aria-label', `${color} 영역 삭제`);
      delBtn.title = '영역 삭제';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        const before = historySnapshot();
        removeRegion(regionState, color);
        visibleRegions.delete(color);
        if (selectedColor === color) {
          selectedColor = regionState.regions[0] || null;
        }
        renderRegionsList();
        canvasView.drawOverlay();
        recordChange(before);
        app.toast(`영역 「${color}」을 지웠습니다`);
      });

      card.addEventListener('click', () => {
        selectedColor = color;
        visibleRegions.add(color);
        renderRegionsList();
        canvasView.drawOverlay();
      });

      card.append(dotBtn, name, visBtn, delBtn);
      if (addBtn) {
        list.insertBefore(card, addBtn);
      } else {
        list.appendChild(card);
      }
    });
  }

  function openLightbox(title, imgData, w, h) {
    const modal = $('#slice-lightbox');
    const titleEl = $('#slice-lightbox-title');
    const canvas = $('#slice-lightbox-canvas');
    if (!modal || !canvas) return;

    titleEl.textContent = title;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = toHex(KEY);
    ctx.fillRect(0, 0, w, h);

    const d = imgData.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p4 = (y * w + x) * 4;
        const a = d[p4 + 3];
        if (a > 0) {
          ctx.fillStyle = `rgba(${d[p4]}, ${d[p4 + 1]}, ${d[p4 + 2]}, ${a / 255})`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    modal.hidden = false;
  }

  function renderPiecesList() {
    const list = $('#rig-pieces-list');
    if (!list) return;
    list.innerHTML = '';

    if (pieces.length === 0) {
      list.innerHTML = '<p class="hint" style="grid-column:1/-1;text-align:center;">보관한 조각이 없습니다</p>';
      return;
    }

    pieces.forEach((piece, index) => {
      const card = document.createElement('div');
      card.className = 'rig-piece-card';
      card.title = '누르면 크게 봅니다';

      const thumb = document.createElement('canvas');
      thumb.className = 'rig-piece-thumb';
      drawPixels(thumb, piece.image, 1, toHex(KEY));

      const title = document.createElement('div');
      title.className = 'rig-piece-title';
      title.textContent = piece.name;

      const actions = document.createElement('div');
      actions.className = 'rig-piece-actions';

      const action = (text, run) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn';
        button.textContent = text;
        button.addEventListener('click', e => {
          e.stopPropagation();
          run();
        });
        actions.appendChild(button);
      };

      action('PNG', async () => {
        await savePng(`${piece.id}.png`, piece.image);
        app.toast(`「${piece.id}.png」을 내려받았습니다`);
      });

      action('삭제', () => {
        const before = historySnapshot();
        pieces.splice(index, 1);
        renderPiecesList();
        recordChange(before);
        app.toast(`조각 「${piece.name}」을 지웠습니다`);
      });

      card.addEventListener('click', () => {
        openLightbox(piece.name, piece.image, piece.image.width, piece.image.height);
      });

      card.append(thumb, title, actions);
      list.appendChild(card);
    });
  }

  function savePiece(image, name, sourceKind = 'region-slice', pieceName = '') {
    const sameName = pieces.find(p => p.name === name && p.sourceKind === sourceKind);
    let normalized = toSliceLibraryItem({
      id: name,
      name,
      png: toPngDataUrl(image),
      width: image.width,
      height: image.height,
      sourceKind,
      piece: pieceName || name,
    });
    if (sameName) {
      normalized = { ...normalized, id: sameName.id, piece: sameName.piece };
    }
    const value = { ...normalized, image };
    const existing = pieces.findIndex(p => p.id === value.id);
    if (existing >= 0) pieces[existing] = value;
    else pieces.push(value);
    renderPiecesList();
  }

  canvasView = mountRigSlice(app, {
    getBaseImage: () => baseImage,
    getSize: () => [width, height],
    getRegionState: () => regionState,
    getSelectedRegion: () => selectedColor,
    getVisibleRegions: () => visibleRegions,
    getActiveTool: () => activeTool,
    getBrushSize: () => brushSize,
    onStrokeStart() {
      strokeBeforeState = historySnapshot();
    },
    onStrokeEnd() {
      if (strokeBeforeState) {
        recordChange(strokeBeforeState);
        strokeBeforeState = null;
      }
    },
    onPaintCell(x, y) {
      if (activeTool === 'brush') {
        if (!selectedColor) {
          if (regionState.regions.length > 0) selectedColor = regionState.regions[0];
          else return;
        }
        if (!visibleRegions.has(selectedColor)) {
          visibleRegions.add(selectedColor);
          renderRegionsList();
        }
        paintCell(regionState, x, y, selectedColor, brushSize);
      } else if (activeTool === 'eraser') {
        eraseCell(regionState, x, y, brushSize);
      }
    },
  });

  // 이벤트 바인딩
  $('#rig-open-base')?.addEventListener('click', async () => {
    try {
      const [file] = await pickFiles({ accept: 'image/*' });
      if (!file) return;
      const before = historySnapshot();
      const image = dropKey(await readImageFile(file));
      setBaseImage(image, file.name);
      recordChange(before);
      app.toast(`「${file.name}」을 불러왔습니다`);
    } catch (error) {
      app.toast(error.message || '원본 그림을 열 수 없습니다');
    }
  });

  // 도구 선택: 붓 / 지우개
  const btnBrush = $('#slice-tool-brush');
  const btnEraser = $('#slice-tool-eraser');

  function updateToolUI() {
    if (btnBrush) {
      btnBrush.setAttribute('aria-pressed', String(activeTool === 'brush'));
      btnBrush.classList.toggle('primary', activeTool === 'brush');
    }
    if (btnEraser) {
      btnEraser.setAttribute('aria-pressed', String(activeTool === 'eraser'));
      btnEraser.classList.toggle('primary', activeTool === 'eraser');
    }
    canvasView.drawOverlay();
  }

  btnBrush?.addEventListener('click', () => {
    activeTool = 'brush';
    updateToolUI();
  });

  btnEraser?.addEventListener('click', () => {
    activeTool = 'eraser';
    updateToolUI();
  });

  // 영역 더하기
  $('#slice-add-region')?.addEventListener('click', () => {
    const nextColor = REGION_PALETTE.find(c => !regionState.regions.includes(c));
    if (!nextColor) {
      return app.toast('더 이상 추가할 수 있는 색 영역이 없습니다 (최대 12개)');
    }
    const before = historySnapshot();
    addRegion(regionState, nextColor);
    visibleRegions.add(nextColor);
    selectedColor = nextColor;
    renderRegionsList();
    canvasView.drawOverlay();
    recordChange(before);
    app.toast(`색 영역 「${nextColor}」을 추가했습니다`);
  });

  // 영역 설정 저장
  $('#slice-save-regions')?.addEventListener('click', async () => {
    try {
      const config = exportRegionConfig(regionState);
      const jsonStr = JSON.stringify(config, null, 2);
      await saveFile('slice-regions-1.json', new Blob([jsonStr], { type: 'application/json' }));
      app.toast('영역 설정(slice-regions-1.json)을 저장했습니다');
    } catch (error) {
      app.toast(error.message || '영역 설정을 저장하지 못했습니다');
    }
  });

  // 영역 설정 불러오기
  $('#slice-load-regions')?.addEventListener('click', async () => {
    try {
      const [file] = await pickFiles({ accept: '.json,application/json' });
      if (!file) return;
      const text = await file.text();
      const parsed = JSON.parse(text);
      const before = historySnapshot();
      const loaded = importRegionConfig(parsed, [width, height]);
      regionState = loaded;
      visibleRegions.clear();
      for (const c of regionState.regions) visibleRegions.add(c);
      selectedColor = regionState.regions[0] || null;
      renderRegionsList();
      syncViews();
      recordChange(before);
      app.toast(`「${file.name}」 영역 설정을 불러왔습니다`);
    } catch (error) {
      app.toast(error.message || '영역 설정을 불러오지 못했습니다');
    }
  });

  // 자르기 실행 (조각으로 저장)
  $('#slice-cut-btn')?.addEventListener('click', () => {
    if (!baseImage) {
      return app.toast('먼저 「그림 올리기」로 캐릭터 그림을 열어주세요');
    }
    if (regionState.regions.length === 0) {
      return app.toast('지정된 색 영역이 없습니다. 「+ 영역 더하기」로 영역을 만드세요');
    }

    const before = historySnapshot();
    const results = sliceByRegions({ image: baseImage, state: regionState });
    let savedCount = 0;
    const emptyColors = [];

    for (const res of results) {
      if (res.isEmpty) {
        if (res.paintedCellCount > 0) emptyColors.push(res.color);
        continue;
      }
      savePiece(res.image, res.color, 'region-slice', res.color);
      savedCount++;
    }

    if (savedCount > 0) {
      recordChange(before);
      app.toast(`조각 ${savedCount}개를 저장했습니다`);
    } else {
      app.toast('추출할 수 있는 유효한 도트가 없습니다');
    }

    if (emptyColors.length > 0) {
      setTimeout(() => {
        app.toast(`빈 조각(${emptyColors.join(', ')})은 투명 그림이어서 건너뛰었습니다`);
      }, 1500);
    }
  });

  // 모두 ZIP 내려받기
  $('#slice-save-all')?.addEventListener('click', async () => {
    if (pieces.length === 0) {
      return app.toast('내려받을 조각이 없습니다');
    }
    try {
      const entries = [];
      for (const piece of pieces) {
        const pngUrl = toPngDataUrl(piece.image);
        const res = await fetch(pngUrl);
        const buf = await res.arrayBuffer();
        entries.push({
          name: `${piece.id}.png`,
          data: new Uint8Array(buf),
        });
      }
      const zipBytes = createStoredZip(entries);
      await saveFile('자르기-조각.zip', new Blob([zipBytes], { type: 'application/zip' }));
      app.toast(`조각 ${pieces.length}개를 ZIP으로 내려받았습니다`);
    } catch (error) {
      app.toast(error.message || '조각 ZIP을 만들지 못했습니다');
    }
  });

  // 크게 보기 모달 닫기
  $('#slice-lightbox-close')?.addEventListener('click', () => {
    const modal = $('#slice-lightbox');
    if (modal) modal.hidden = true;
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const modal = $('#slice-lightbox');
      if (modal && !modal.hidden) modal.hidden = true;
    }
  });

  undoButton?.addEventListener('click', () => applyHistory(history.undo(historySnapshot())));
  redoButton?.addEventListener('click', () => applyHistory(history.redo(historySnapshot())));

  // 초기 자동 보관 복원 및 렌더링
  restoreAutosave();
  renderRegionsList();
  renderPiecesList();
  updateUndoRedo();
  updateToolUI();

  return {
    shown() {
      canvasView.fit();
      canvasView.render();
    },
    getPieces: () => pieces,
    getRegionState: () => regionState,
    getSelectedRegion: () => selectedColor,
    getVisibleRegions: () => visibleRegions,
    snapshot() {
      return {
        canvas: [width, height],
        basePng: baseImage ? toPngDataUrl(baseImage) : null,
        item: baseTitle,
        regionConfig: exportRegionConfig(regionState),
        pieces: pieces.map(p => toSliceLibraryItem(p)),
      };
    },
    async restore(saved) {
      if (!saved || typeof saved !== 'object') return;
      const canvas = Array.isArray(saved.canvas) ? saved.canvas : CURRENT_PROFILE.canvas;
      width = Number(canvas[0]) || 72;
      height = Number(canvas[1]) || 64;
      baseTitle = String(saved.item || '그림');
      baseImage = saved.basePng ? await readDataUrl(saved.basePng) : null;
      pieces = [];
      for (const value of saved.pieces || []) {
        const item = toSliceLibraryItem(value);
        pieces.push({ ...item, image: await readDataUrl(item.png) });
      }
      if (saved.regionConfig) {
        try {
          regionState = importRegionConfig(saved.regionConfig, [width, height]);
          visibleRegions.clear();
          for (const c of regionState.regions) visibleRegions.add(c);
          selectedColor = regionState.regions[0] || null;
        } catch {
          regionState = createRegionSliceState(width, height);
        }
      } else {
        restoreAutosave();
      }
      history.clear();
      syncViews();
      renderRegionsList();
      renderPiecesList();
      updateUndoRedo();
      if (baseImage) canvasView.fit();
    },
  };
}
