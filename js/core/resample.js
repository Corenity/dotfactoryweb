// 작은 분석판 만들기 — PIL Image.thumbnail(LANCZOS) 과 같은 계산입니다.
// 축소 기준(몸 중심 · 발 위치)을 이 분석판에서 재므로, PC 와 같은 크기 · 같은 값이 나와야 결과가 맞습니다.

const PRECISION_BITS = 32 - 8 - 2;

function lanczos(x) {
  if (x <= -3 || x >= 3) return 0;
  return sinc(x) * sinc(x / 3);
}

function sinc(x) {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/** PIL precompute_coeffs + normalize_coeffs_8bpc 와 같은 정수 가중치를 만듭니다. */
function coefficients(inSize, outSize) {
  const scale = inSize / outSize;
  const filterscale = Math.max(scale, 1);
  const support = 3 * filterscale;
  const ss = 1 / filterscale;
  const bounds = [];
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    const k = new Float64Array(xmax);
    let ww = 0;
    for (let x = 0; x < xmax; x++) {
      const w = lanczos((x + xmin - center + 0.5) * ss);
      k[x] = w;
      ww += w;
    }
    const ints = new Int32Array(xmax);
    for (let x = 0; x < xmax; x++) {
      const v = ww === 0 ? k[x] : k[x] / ww;
      ints[x] = Math.trunc(v < 0 ? -0.5 + v * (1 << PRECISION_BITS) : 0.5 + v * (1 << PRECISION_BITS));
    }
    bounds.push({ xmin, ints });
  }
  return bounds;
}

function clip8(v) {
  const s = Math.floor(v / (1 << PRECISION_BITS));
  return s < 0 ? 0 : s > 255 ? 255 : s;
}

function resizeHorizontal(img, outW) {
  const { width: w, height: h, data } = img;
  const coeffs = coefficients(w, outW);
  const out = new Uint8ClampedArray(outW * h * 4);
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < outW; xx++) {
      const { xmin, ints } = coeffs[xx];
      for (let c = 0; c < 4; c++) {
        let ss = 1 << (PRECISION_BITS - 1);
        for (let x = 0; x < ints.length; x++) ss += data[(y * w + x + xmin) * 4 + c] * ints[x];
        out[(y * outW + xx) * 4 + c] = clip8(ss);
      }
    }
  }
  return { width: outW, height: h, data: out };
}

function resizeVertical(img, outH) {
  const { width: w, height: h, data } = img;
  const coeffs = coefficients(h, outH);
  const out = new Uint8ClampedArray(w * outH * 4);
  for (let yy = 0; yy < outH; yy++) {
    const { xmin: ymin, ints } = coeffs[yy];
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let ss = 1 << (PRECISION_BITS - 1);
        for (let y = 0; y < ints.length; y++) ss += data[((y + ymin) * w + x) * 4 + c] * ints[y];
        out[(yy * w + x) * 4 + c] = clip8(ss);
      }
    }
  }
  return { width: w, height: outH, data: out };
}

/** PIL thumbnail 의 크기 계산(비율 유지, 키우지 않음)입니다. */
export function thumbnailSize(width, height, maxW, maxH) {
  let x = maxW, y = maxH;
  const aspect = width / height;
  const roundAspect = (number, key) => {
    const lo = Math.floor(number), hi = Math.ceil(number);
    return Math.max(key(lo) <= key(hi) ? lo : hi, 1);
  };
  if (x / y >= aspect) x = roundAspect(y * aspect, n => Math.abs(aspect - n / y));
  else y = roundAspect(x / aspect, n => (n === 0 ? 0 : Math.abs(aspect - x / n)));
  if (x >= width && y >= height) return [width, height];
  return [x, y];
}

/**
 * 그림을 maxW×maxH 안으로 줄인 분석판을 돌려줍니다. 이미 작으면 복사본을 돌려줍니다.
 * PIL 은 2배 넘게 큰 그림(분석판 720 이면 원본 2880 이상)을 먼저 정수배로 줄이는데, 그 단계는 옮기지 않았습니다.
 */
export function thumbnail(img, maxW, maxH) {
  const [w, h] = thumbnailSize(img.width, img.height, maxW, maxH);
  if (w === img.width && h === img.height) return { width: w, height: h, data: new Uint8ClampedArray(img.data) };
  // PIL 은 RGBA 를 알파 곱한 값으로 바꿔 줄입니다. 불투명한 그림은 결과가 같아 그대로 둡니다.
  let out = img;
  if (w !== img.width) out = resizeHorizontal(out, w);
  if (h !== img.height) out = resizeVertical(out, h);
  return out;
}
