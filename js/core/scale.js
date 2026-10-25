// 도트 그림 확대 — 한 칸을 같은 RGBA 값의 N×N 칸으로 복제합니다. DOM을 쓰지 않습니다.

export const MAX_SCALED_SIDE = 2048;

export function scaledSize(image, factor, maxSide = MAX_SCALED_SIDE) {
  if (!Number.isInteger(factor) || factor < 1) throw new Error('확대 배율은 1 이상의 정수여야 합니다.');
  const width = image.width * factor;
  const height = image.height * factor;
  if (width > maxSide || height > maxSide) {
    throw new Error(`결과 ${width}×${height}px가 가로·세로 상한 ${maxSide}px를 넘습니다.`);
  }
  return [width, height];
}

export function scaleNearest(image, factor, maxSide = MAX_SCALED_SIDE) {
  const [width, height] = scaledSize(image, factor, maxSide);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let sy = 0; sy < image.height; sy++) {
    for (let sx = 0; sx < image.width; sx++) {
      const source = (sy * image.width + sx) * 4;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const target = ((sy * factor + dy) * width + sx * factor + dx) * 4;
          data[target] = image.data[source];
          data[target + 1] = image.data[source + 1];
          data[target + 2] = image.data[source + 2];
          data[target + 3] = image.data[source + 3];
        }
      }
    }
  }
  return { width, height, data };
}
