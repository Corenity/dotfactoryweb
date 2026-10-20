// numpy · Python 과 같은 값을 내기 위한 작은 수치 함수들입니다.
// PC 도트 공장(Python)과 결과를 맞추려면 반올림 · 중앙값 · 분위수를 그쪽과 똑같이 계산해야 합니다.

/** Python round() · np.rint 처럼 .5 는 짝수 쪽으로 반올림합니다. */
export function roundHalfEven(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** np.median — 개수가 짝수면 가운데 두 값의 평균입니다. */
export function median(values) {
  if (!values.length) return NaN;
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** np.quantile 기본(linear) 방식입니다. */
export function quantile(values, q) {
  const sorted = Float64Array.from(values).sort();
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** np.linspace(start, stop, num) — 끝값은 정확히 stop 입니다. */
export function linspace(start, stop, num) {
  const out = new Array(num);
  const step = (stop - start) / (num - 1);
  for (let i = 0; i < num; i++) out[i] = i * step + start;
  out[num - 1] = stop;
  return out;
}

/** 색 세 값을 사전 순으로 비교합니다(파이썬 튜플 비교). */
export function compareRgb(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
