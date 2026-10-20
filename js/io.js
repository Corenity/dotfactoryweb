// 그림 파일 읽기 · 그리기 · 내려받기. 화면 쪽 공용 도구입니다.

/** 파일(Blob)을 { width, height, data } 그림으로 읽습니다. 색 보정 없이 파일에 적힌 값 그대로 읽습니다. */
export async function readImageFile(file) {
  let source;
  try {
    source = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch {
    source = await loadImageElement(file);
  }
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  if (source.close) source.close();
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data };
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('그림을 읽지 못했습니다')); };
    img.src = url;
  });
}

/** data URL(PNG)을 그림으로 읽습니다. */
export async function readDataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return readImageFile(blob);
}

export function toCanvas(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return canvas;
}

export function toPngDataUrl(img) {
  return toCanvas(img).toDataURL('image/png');
}

/** 칸 하나를 scale 배로 키워 그립니다. 바탕(checker · 색 · 없음)을 먼저 깝니다. */
export function drawPixels(canvas, img, scale, backdrop = 'checker') {
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  paintBackdrop(ctx, canvas.width, canvas.height, Math.max(4, scale), backdrop);
  ctx.drawImage(toCanvas(img), 0, 0, canvas.width, canvas.height);
}

export function paintBackdrop(ctx, w, h, cell, backdrop) {
  if (backdrop === 'checker') {
    ctx.fillStyle = '#2a2a30';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3a3a42';
    for (let y = 0; y < h; y += cell) for (let x = (y / cell) % 2 ? cell : 0; x < w; x += cell * 2) ctx.fillRect(x, y, cell, cell);
  } else {
    ctx.clearRect(0, 0, w, h);
    if (backdrop) { ctx.fillStyle = backdrop; ctx.fillRect(0, 0, w, h); }
  }
}

function dataUrlToBlob(url) {
  const [head, body] = url.split(',');
  const bytes = atob(body);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i);
  return new Blob([out], { type: head.slice(5).split(';')[0] });
}

/**
 * 파일을 휴대폰에 남깁니다. 아이폰은 공유 창(사진 저장 · 파일에 저장)을, 그 밖은 내려받기를 씁니다.
 * 공유 창은 누른 직후에만 열리므로 그림 변환을 기다리지 않게 data URL 을 바로 만들어 넘깁니다.
 */
export async function saveFile(name, dataUrlOrBlob) {
  const blob = typeof dataUrlOrBlob === 'string' ? dataUrlToBlob(dataUrlOrBlob) : dataUrlOrBlob;
  const file = new File([blob], name, { type: blob.type });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

export function savePng(name, img) {
  return saveFile(name, toPngDataUrl(img));
}

export function saveJson(name, value) {
  return saveFile(name, new Blob([JSON.stringify(value)], { type: 'application/json' }));
}

/** 파일 고르기 창을 엽니다. 고른 파일 목록을 돌려줍니다(취소하면 빈 목록). */
export function pickFiles({ accept = 'image/*', multiple = false } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve([...input.files]), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}

export function baseName(name) {
  return String(name || '그림').replace(/\.[^.]+$/, '');
}
