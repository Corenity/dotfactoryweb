// site/js/core/region-slice.js — 색 영역 자르기(Color Region Slicing) 순수 모듈
// DOM이나 브라우저 API를 쓰지 않고 순수 자료 구조로 동작합니다.

export const SLICE_REGIONS_FORMAT = 'slice-regions-1';

// 초록 배경(3, 192, 55 / #03c037) 및 지피티 초록(3, 203, 47 / #03cb2f), 어두운 화면 바탕(#1c1c1e)과 뚜렷이 구별되는 고대비 12가지 색상 팔레트
// CIE76 색차 기준: 모든 두 색 사이 ΔE >= 30, 초록 배경과의 ΔE >= 50, 어두운 바탕(#1c1c1e)과의 ΔE >= 30, 밝기 L* >= 35
export const REGION_PALETTE = Object.freeze([
  'ff3b30', // 빨강
  '0a84ff', // 파랑
  'ffd60a', // 노랑
  'ff9500', // 주황
  '5ac8fa', // 하늘
  '7928ca', // 보라
  'f032e6', // 자주
  'c2185b', // 체리
  '9a6324', // 갈색
  'd1a8ff', // 연보라
  '8e8e93', // 회색
  'ffffff', // 흰색
]);

export function normalizeColor(color) {
  const hex = String(color || '').trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex)) {
    throw new Error(`색상 코드 「${color}」 형식이 올바르지 않습니다 (6자리 16진수 필요)`);
  }
  return hex;
}

export function createRegionSliceState(width, height, options = {}) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isInteger(w) || w <= 0 || !Number.isInteger(h) || h <= 0) {
    throw new Error(`그림판 크기(${width}×${height})가 올바르지 않습니다`);
  }
  const regions = Array.isArray(options.regions)
    ? options.regions.map(normalizeColor)
    : [];
  const grid = options.grid instanceof Uint8Array && options.grid.length === w * h
    ? new Uint8Array(options.grid)
    : new Uint8Array(w * h);

  return {
    width: w,
    height: h,
    regions: [...new Set(regions)],
    grid,
  };
}

export function cloneRegionSliceState(state) {
  return {
    width: state.width,
    height: state.height,
    regions: [...state.regions],
    grid: new Uint8Array(state.grid),
  };
}

export function addRegion(state, color) {
  const hex = normalizeColor(color);
  if (state.regions.includes(hex)) return state.regions.indexOf(hex) + 1;
  state.regions.push(hex);
  return state.regions.length;
}

export function removeRegion(state, color) {
  const hex = normalizeColor(color);
  const index = state.regions.indexOf(hex);
  if (index === -1) return false;

  const targetLabel = index + 1;
  state.regions.splice(index, 1);

  // 해당 영역 칸은 지우고, 뒤쪽 영역 라벨은 1씩 감소
  const grid = state.grid;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === targetLabel) {
      grid[i] = 0;
    } else if (grid[i] > targetLabel) {
      grid[i]--;
    }
  }
  return true;
}

export function recolorRegion(state, from, to) {
  if (!state || !Array.isArray(state.regions)) {
    throw new Error('올바른 영역 상태가 아닙니다');
  }
  const fromHex = normalizeColor(from);
  const toHex = normalizeColor(to);
  if (fromHex === toHex) {
    throw new Error(`동일한 색상(${fromHex})으로 바꿀 수 없습니다`);
  }
  const fromIndex = state.regions.indexOf(fromHex);
  if (fromIndex === -1) {
    throw new Error(`존재하지 않는 영역 색상(${fromHex})입니다`);
  }
  if (state.regions.includes(toHex)) {
    throw new Error(`이미 사용 중인 영역 색상(${toHex})입니다`);
  }
  state.regions[fromIndex] = toHex;
  return true;
}

export function paintCell(state, x, y, color, brushSize = 1) {
  const hex = normalizeColor(color);
  let label = state.regions.indexOf(hex) + 1;
  if (label === 0) {
    label = addRegion(state, hex);
  }

  const { width, height, grid } = state;
  const size = Math.max(1, Math.min(8, Math.floor(brushSize)));
  const offset = Math.floor((size - 1) / 2);
  let changed = 0;

  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const cx = x - offset + dx;
      const cy = y - offset + dy;
      if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
        const idx = cy * width + cx;
        if (grid[idx] !== label) {
          grid[idx] = label;
          changed++;
        }
      }
    }
  }
  return changed;
}

export function eraseCell(state, x, y, brushSize = 1) {
  const { width, height, grid } = state;
  const size = Math.max(1, Math.min(8, Math.floor(brushSize)));
  const offset = Math.floor((size - 1) / 2);
  let changed = 0;

  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const cx = x - offset + dx;
      const cy = y - offset + dy;
      if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
        const idx = cy * width + cx;
        if (grid[idx] !== 0) {
          grid[idx] = 0;
          changed++;
        }
      }
    }
  }
  return changed;
}

export function sliceByRegions({ image, state }) {
  if (!image || !image.data || !image.width || !image.height) {
    throw new Error('자르기할 원본 이미지가 올바르지 않습니다');
  }
  if (image.width !== state.width || image.height !== state.height) {
    throw new Error(`이미지 크기(${image.width}×${image.height})가 영역 설정 크기(${state.width}×${state.height})와 다릅니다`);
  }

  const { width, height, regions, grid } = state;
  const src = image.data;
  const totalPixels = width * height;

  const results = [];

  for (let rIdx = 0; rIdx < regions.length; rIdx++) {
    const color = regions[rIdx];
    const targetLabel = rIdx + 1;
    const pieceBuffer = new Uint8ClampedArray(totalPixels * 4);
    let pieceCount = 0;
    let paintedCellCount = 0;

    for (let i = 0; i < totalPixels; i++) {
      if (grid[i] === targetLabel) {
        paintedCellCount++;
        const p4 = i * 4;
        const a = src[p4 + 3];
        if (a > 0) {
          pieceBuffer[p4] = src[p4];
          pieceBuffer[p4 + 1] = src[p4 + 1];
          pieceBuffer[p4 + 2] = src[p4 + 2];
          pieceBuffer[p4 + 3] = a;
          pieceCount++;
        }
      }
    }

    results.push({
      color,
      image: {
        width,
        height,
        data: pieceBuffer,
      },
      pieceCount,
      paintedCellCount,
      isEmpty: pieceCount === 0,
    });
  }

  return results;
}

export function exportRegionConfig(state) {
  const { width, height, regions, grid } = state;
  const rows = [];
  for (let y = 0; y < height; y++) {
    let rowStr = '';
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      const val = grid[rowStart + x];
      if (val === 0) {
        rowStr += '.';
      } else {
        const hexChar = (val - 1).toString(16);
        rowStr += hexChar;
      }
    }
    rows.push(rowStr);
  }

  return {
    format: SLICE_REGIONS_FORMAT,
    canvas: [width, height],
    regions: [...regions],
    rows,
  };
}

export function importRegionConfig(config, expectedCanvas = null) {
  if (!config || typeof config !== 'object') {
    throw new Error('영역 설정 자료가 올바르지 않습니다');
  }
  if (config.format !== SLICE_REGIONS_FORMAT) {
    throw new Error(`지원하지 않는 영역 설정 형식(「${config.format}」)입니다`);
  }
  if (!Array.isArray(config.canvas) || config.canvas.length !== 2) {
    throw new Error('영역 설정의 그림판 크기(canvas)가 올바르지 않습니다');
  }

  const [w, h] = [Number(config.canvas[0]), Number(config.canvas[1])];
  if (!Number.isInteger(w) || w <= 0 || !Number.isInteger(h) || h <= 0) {
    throw new Error(`영역 설정의 그림판 크기(${config.canvas[0]}×${config.canvas[1]})가 올바르지 않습니다`);
  }

  if (expectedCanvas) {
    const [ew, eh] = expectedCanvas;
    if (w !== ew || h !== eh) {
      throw new Error(`불러온 설정의 그림판 크기(${w}×${h})가 현재 그림판 크기(${ew}×${eh})와 다릅니다`);
    }
  }

  if (!Array.isArray(config.regions)) {
    throw new Error('영역 색상 목록(regions)이 올바르지 않습니다');
  }
  const regions = config.regions.map(normalizeColor);

  if (!Array.isArray(config.rows) || config.rows.length !== h) {
    throw new Error(`영역 칸 행 수(${config.rows?.length})가 높이(${h})와 일치하지 않습니다`);
  }

  const grid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = String(config.rows[y] || '');
    if (row.length !== w) {
      throw new Error(`${y + 1}번째 행의 너비(${row.length})가 그림판 너비(${w})와 일치하지 않습니다`);
    }
    const rowStart = y * w;
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch !== '.') {
        const val = parseInt(ch, 16);
        if (Number.isNaN(val) || val < 0 || val >= regions.length) {
          throw new Error(`좌표 (${x}, ${y})의 영역 식별자 「${ch}」가 올바르지 않습니다`);
        }
        grid[rowStart + x] = val + 1;
      }
    }
  }

  return {
    width: w,
    height: h,
    regions,
    grid,
  };
}

export function shouldReinitRegionSlice(prevImage, nextImage) {
  if (!prevImage && !nextImage) return false;
  if (!prevImage || !nextImage) return true;
  if (prevImage === nextImage) return false;
  if (prevImage.width !== nextImage.width || prevImage.height !== nextImage.height) return true;
  const p1 = prevImage.data, p2 = nextImage.data;
  if (p1.length !== p2.length) return true;
  for (let i = 0; i < p1.length; i++) {
    if (p1[i] !== p2[i]) return true;
  }
  return false;
}
