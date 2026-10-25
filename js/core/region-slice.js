// 색 영역 자르기 순수 모듈입니다. DOM이나 브라우저 API를 쓰지 않습니다.

export const SLICE_REGIONS_FORMAT = 'slice-regions-2';
export const LEGACY_SLICE_REGIONS_FORMAT = 'slice-regions-1';

export const REGION_PALETTE = Object.freeze([
  'ff3b30', '0a84ff', 'ffd60a', 'ff9500', '5ac8fa', '7928ca',
  'f032e6', 'c2185b', '9a6324', 'd1a8ff', '8e8e93', 'ffffff',
]);

const NEIGHBORS = [[0, -1], [-1, 0], [1, 0], [0, 1]];

export function regionDotAction(selectedColor, color) {
  return selectedColor === color ? 'recolor' : 'select';
}

export function normalizeColor(color) {
  const hex = String(color || '').trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex)) {
    throw new Error(`색상 코드 「${color}」 형식이 올바르지 않습니다 (6자리 16진수 필요)`);
  }
  return hex;
}

function dimensions(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isInteger(w) || w <= 0 || !Number.isInteger(h) || h <= 0) {
    throw new Error(`그림판 크기(${width}×${height})가 올바르지 않습니다`);
  }
  return [w, h];
}

function masksFromGrid(grid, regionCount, size) {
  const masks = Array.from({ length: regionCount }, () => new Uint8Array(size));
  if (!(grid instanceof Uint8Array) || grid.length !== size) return masks;
  for (let i = 0; i < size; i++) {
    const label = grid[i];
    if (label > 0 && label <= regionCount) masks[label - 1][i] = 1;
  }
  return masks;
}

export function createRegionSliceState(width, height, options = {}) {
  const [w, h] = dimensions(width, height);
  const regions = Array.isArray(options.regions) ? options.regions.map(normalizeColor) : [];
  if (new Set(regions).size !== regions.length) throw new Error('영역 색상은 서로 달라야 합니다');
  const size = w * h;
  const masks = Array.isArray(options.masks) && options.masks.length === regions.length
    ? options.masks.map(mask => mask instanceof Uint8Array && mask.length === size
      ? new Uint8Array(mask)
      : new Uint8Array(size))
    : masksFromGrid(options.grid, regions.length, size);
  return { width: w, height: h, regions, masks };
}

export function cloneRegionSliceState(state) {
  return createRegionSliceState(state.width, state.height, {
    regions: state.regions,
    masks: state.masks,
  });
}

export function getRegionMask(state, color) {
  const index = state.regions.indexOf(normalizeColor(color));
  return index < 0 ? null : state.masks[index];
}

export function regionDepth(state, color) {
  const index = state.regions.indexOf(normalizeColor(color));
  return index < 0 ? 0 : index + 1;
}

export function addRegion(state, color) {
  const hex = normalizeColor(color);
  const existing = state.regions.indexOf(hex);
  if (existing >= 0) return existing + 1;
  state.regions.push(hex);
  state.masks.push(new Uint8Array(state.width * state.height));
  return state.regions.length;
}

export function removeRegion(state, color) {
  const index = state.regions.indexOf(normalizeColor(color));
  if (index < 0) return false;
  state.regions.splice(index, 1);
  state.masks.splice(index, 1);
  return true;
}

export function moveRegion(state, color, direction) {
  const index = state.regions.indexOf(normalizeColor(color));
  const next = direction === 'up' ? index + 1 : direction === 'down' ? index - 1 : index;
  if (index < 0 || next < 0 || next >= state.regions.length || next === index) return false;
  [state.regions[index], state.regions[next]] = [state.regions[next], state.regions[index]];
  [state.masks[index], state.masks[next]] = [state.masks[next], state.masks[index]];
  return true;
}

export function canMoveRegion(state, color, direction) {
  if (!color || !state || !Array.isArray(state.regions)) return false;
  const index = state.regions.indexOf(normalizeColor(color));
  if (index < 0) return false;
  if (direction === 'up') return index < state.regions.length - 1;
  if (direction === 'down') return index > 0;
  return false;
}

export function recolorRegion(state, from, to) {
  const fromHex = normalizeColor(from);
  const toHex = normalizeColor(to);
  if (fromHex === toHex) throw new Error(`동일한 색상(${fromHex})으로 바꿀 수 없습니다`);
  const index = state.regions.indexOf(fromHex);
  if (index < 0) throw new Error(`존재하지 않는 영역 색상(${fromHex})입니다`);
  if (state.regions.includes(toHex)) throw new Error(`이미 사용 중인 영역 색상(${toHex})입니다`);
  state.regions[index] = toHex;
  return true;
}

function changeCells(state, x, y, color, brushSize, value) {
  const hex = normalizeColor(color);
  let index = state.regions.indexOf(hex);
  if (index < 0) index = addRegion(state, hex) - 1;
  const mask = state.masks[index];
  const size = Math.max(1, Math.min(8, Math.floor(brushSize)));
  const offset = Math.floor((size - 1) / 2);
  let changed = 0;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const cx = x - offset + dx;
      const cy = y - offset + dy;
      if (cx < 0 || cx >= state.width || cy < 0 || cy >= state.height) continue;
      const cell = cy * state.width + cx;
      if (mask[cell] !== value) {
        mask[cell] = value;
        changed++;
      }
    }
  }
  return changed;
}

export function paintCell(state, x, y, color, brushSize = 1) {
  return changeCells(state, x, y, color, brushSize, 1);
}

export function eraseCell(state, x, y, color, brushSize = 1) {
  const mask = getRegionMask(state, color);
  if (!mask) return 0;
  return changeCells(state, x, y, color, brushSize, 0);
}

function pixelKey(data, pixel) {
  const p = pixel * 4;
  return data[p + 3] === 0 ? null : `${data[p]},${data[p + 1]},${data[p + 2]},${data[p + 3]}`;
}

function addCount(counts, order, key) {
  if (!key) return;
  if (!counts.has(key)) order.push(key);
  counts.set(key, (counts.get(key) || 0) + 1);
}

function chooseColor(counts, overallCounts, order) {
  let best = null;
  for (const key of order) {
    const count = counts.get(key) || 0;
    const bestCount = best ? counts.get(best) || 0 : -1;
    const overall = overallCounts.get(key) || 0;
    const bestOverall = best ? overallCounts.get(best) || 0 : -1;
    if (count > bestCount || (count === bestCount && overall > bestOverall)) best = key;
  }
  return best;
}

function setPixelFromKey(data, pixel, key) {
  if (!key) return;
  data.set(key.split(',').map(Number), pixel * 4);
}

function copyPixel(source, target, pixel) {
  const p = pixel * 4;
  if (source[p + 3] > 0) target.set(source.subarray(p, p + 4), p);
}

function isBoundary(mask, width, height, pixel) {
  const x = pixel % width;
  const y = Math.floor(pixel / width);
  return NEIGHBORS.some(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    return nx < 0 || nx >= width || ny < 0 || ny >= height || !mask[ny * width + nx];
  });
}

function neighborPixels(width, height, pixel) {
  const x = pixel % width;
  const y = Math.floor(pixel / width);
  const result = [];
  for (const [dx, dy] of NEIGHBORS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) result.push(ny * width + nx);
  }
  return result;
}

function fillOverlapHoles({ source, target, mask, blank, width, height }) {
  const overallCounts = new Map();
  const overallOrder = [];
  const outlineCounts = new Map();
  const outlineOrder = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const key = pixelKey(source, i);
    addCount(overallCounts, overallOrder, key);
    if (isBoundary(mask, width, height, i)) addCount(outlineCounts, outlineOrder, key);
  }
  const outline = chooseColor(outlineCounts, overallCounts, outlineOrder);
  const remaining = new Set();
  for (let i = 0; i < blank.length; i++) {
    if (!blank[i]) continue;
    if (isBoundary(mask, width, height, i)) {
      if (outline) setPixelFromKey(target, i, outline);
      continue;
    }
    remaining.add(i);
  }

  while (remaining.size) {
    const layer = [];
    for (const pixel of remaining) {
      const counts = new Map();
      const order = [];
      for (const neighbor of neighborPixels(width, height, pixel)) {
        const key = pixelKey(target, neighbor);
        if (key && key !== outline) addCount(counts, order, key);
      }
      const color = chooseColor(counts, overallCounts, order);
      if (color) layer.push([pixel, color]);
    }
    if (!layer.length) break;
    for (const [pixel, color] of layer) {
      setPixelFromKey(target, pixel, color);
      remaining.delete(pixel);
    }
  }

  if (remaining.size) {
    const counts = new Map();
    const order = [];
    for (let i = 0; i < target.length / 4; i++) {
      const key = pixelKey(target, i);
      if (key && key !== outline) addCount(counts, order, key);
    }
    const fallback = chooseColor(counts, overallCounts, order);
    if (fallback) for (const pixel of remaining) setPixelFromKey(target, pixel, fallback);
  }
}

export function sliceByRegions({ image, state }) {
  if (!image?.data || !image.width || !image.height) throw new Error('자르기할 원본 이미지가 올바르지 않습니다');
  if (image.width !== state.width || image.height !== state.height) {
    throw new Error(`이미지 크기(${image.width}×${image.height})가 영역 설정 크기(${state.width}×${state.height})와 다릅니다`);
  }
  const { width, height, regions, masks } = state;
  const totalPixels = width * height;
  return regions.map((color, index) => {
    const mask = masks[index];
    const target = new Uint8ClampedArray(totalPixels * 4);
    const blank = new Uint8Array(totalPixels);
    let paintedCellCount = 0;
    for (let pixel = 0; pixel < totalPixels; pixel++) {
      if (!mask[pixel]) continue;
      paintedCellCount++;
      let covered = false;
      for (let higher = index + 1; higher < masks.length; higher++) {
        if (masks[higher][pixel]) {
          covered = true;
          break;
        }
      }
      if (covered) blank[pixel] = 1;
      else copyPixel(image.data, target, pixel);
    }
    fillOverlapHoles({ source: image.data, target, mask, blank, width, height });
    let pieceCount = 0;
    for (let pixel = 0; pixel < totalPixels; pixel++) if (target[pixel * 4 + 3] > 0) pieceCount++;
    return {
      color,
      depth: index + 1,
      image: { width, height, data: target },
      pieceCount,
      paintedCellCount,
      isEmpty: pieceCount === 0,
    };
  });
}

function maskRows(mask, width, height) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) row += mask[y * width + x] ? '1' : '.';
    rows.push(row);
  }
  return rows;
}

export function exportRegionConfig(state) {
  return {
    format: SLICE_REGIONS_FORMAT,
    canvas: [state.width, state.height],
    regions: state.regions.map((color, index) => ({
      color,
      depth: index + 1,
      rows: maskRows(state.masks[index], state.width, state.height),
    })),
  };
}

function validateCanvas(config, expectedCanvas) {
  if (!Array.isArray(config.canvas) || config.canvas.length !== 2) {
    throw new Error('영역 설정의 그림판 크기(canvas)가 올바르지 않습니다');
  }
  const [w, h] = dimensions(config.canvas[0], config.canvas[1]);
  if (expectedCanvas && (w !== expectedCanvas[0] || h !== expectedCanvas[1])) {
    throw new Error(`불러온 설정의 그림판 크기(${w}×${h})가 현재 그림판 크기(${expectedCanvas[0]}×${expectedCanvas[1]})와 다릅니다`);
  }
  return [w, h];
}

function readMaskRows(rows, width, height, filled = ch => ch === '1') {
  if (!Array.isArray(rows) || rows.length !== height) {
    throw new Error(`영역 칸 행 수(${rows?.length})가 높이(${height})와 일치하지 않습니다`);
  }
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = String(rows[y] || '');
    if (row.length !== width) throw new Error(`${y + 1}번째 행의 너비(${row.length})가 그림판 너비(${width})와 일치하지 않습니다`);
    for (let x = 0; x < width; x++) if (filled(row[x], x, y)) mask[y * width + x] = 1;
  }
  return mask;
}

function importLegacy(config, width, height) {
  if (!Array.isArray(config.regions)) throw new Error('영역 색상 목록(regions)이 올바르지 않습니다');
  const regions = config.regions.map(normalizeColor);
  const masks = regions.map((_, label) => readMaskRows(config.rows, width, height, (ch, x, y) => {
    if (ch === '.') return false;
    const value = parseInt(ch, 16);
    if (Number.isNaN(value) || value < 0 || value >= regions.length) {
      throw new Error(`좌표 (${x}, ${y})의 영역 식별자 「${ch}」가 올바르지 않습니다`);
    }
    return value === label;
  }));
  return createRegionSliceState(width, height, { regions, masks });
}

export function importRegionConfig(config, expectedCanvas = null) {
  if (!config || typeof config !== 'object') throw new Error('영역 설정 자료가 올바르지 않습니다');
  if (![SLICE_REGIONS_FORMAT, LEGACY_SLICE_REGIONS_FORMAT].includes(config.format)) {
    throw new Error(`지원하지 않는 영역 설정 형식(「${config.format}」)입니다`);
  }
  const [width, height] = validateCanvas(config, expectedCanvas);
  if (config.format === LEGACY_SLICE_REGIONS_FORMAT) return importLegacy(config, width, height);
  if (!Array.isArray(config.regions)) throw new Error('영역 목록(regions)이 올바르지 않습니다');
  const entries = config.regions.map(region => ({
    color: normalizeColor(region?.color),
    depth: Number(region?.depth),
    rows: region?.rows,
  }));
  const depths = entries.map(region => region.depth).sort((a, b) => a - b);
  if (depths.some((depth, index) => !Number.isInteger(depth) || depth !== index + 1)) {
    throw new Error('영역 깊이는 1부터 겹치지 않게 이어져야 합니다');
  }
  entries.sort((a, b) => a.depth - b.depth);
  return createRegionSliceState(width, height, {
    regions: entries.map(region => region.color),
    masks: entries.map(region => readMaskRows(region.rows, width, height)),
  });
}

export function regionAutosaveKey(profileId, legacy = false) {
  const id = String(profileId || 'project-c');
  return `dotfactory-web/${legacy ? LEGACY_SLICE_REGIONS_FORMAT : SLICE_REGIONS_FORMAT}/${id}`;
}

export function saveRegionAutosave(storage, profileId, state) {
  const key = regionAutosaveKey(profileId);
  storage.setItem(key, JSON.stringify(exportRegionConfig(state)));
  return key;
}

export function loadRegionAutosave(storage, profileId, expectedCanvas = null) {
  const key = regionAutosaveKey(profileId);
  const legacyKey = regionAutosaveKey(profileId, true);
  const current = storage.getItem(key);
  const legacy = current == null ? storage.getItem(legacyKey) : null;
  const raw = current ?? legacy;
  if (raw == null) return null;
  return {
    state: importRegionConfig(JSON.parse(raw), expectedCanvas),
    sourceKey: current == null ? legacyKey : key,
    targetKey: key,
  };
}

/** 영역 설정을 대보기용 RGBA 그림으로 바꿉니다. 겹친 칸은 깊이가 높은 영역 색입니다. */
export function regionGuideImage(state) {
  if (!state || !Number.isInteger(state.width) || !Number.isInteger(state.height)
      || !Array.isArray(state.regions) || !Array.isArray(state.masks)) {
    throw new Error('영역 설정 자료가 올바르지 않습니다');
  }
  const data = new Uint8ClampedArray(state.width * state.height * 4);
  for (let index = 0; index < state.regions.length; index++) {
    const hex = normalizeColor(state.regions[index]);
    const rgb = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    const mask = state.masks[index];
    if (!(mask instanceof Uint8Array) || mask.length !== state.width * state.height) throw new Error('영역 설정 자료가 올바르지 않습니다');
    for (let pixel = 0; pixel < mask.length; pixel++) {
      if (!mask[pixel]) continue;
      const p = pixel * 4;
      data[p] = rgb[0];
      data[p + 1] = rgb[1];
      data[p + 2] = rgb[2];
      data[p + 3] = 255;
    }
  }
  return { width: state.width, height: state.height, data };
}

export function shouldReinitRegionSlice(prevImage, nextImage) {
  if (!prevImage && !nextImage) return false;
  if (!prevImage || !nextImage) return true;
  if (prevImage === nextImage) return false;
  if (prevImage.width !== nextImage.width || prevImage.height !== nextImage.height) return true;
  if (prevImage.data.length !== nextImage.data.length) return true;
  for (let i = 0; i < prevImage.data.length; i++) if (prevImage.data[i] !== nextImage.data[i]) return true;
  return false;
}
