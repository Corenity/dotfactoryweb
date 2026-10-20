// 축소는 큰 그림 전체를 훑어 휴대폰에서 몇 초 걸릴 수 있어, 화면이 멈추지 않게 따로 돌립니다.
import { restore } from './core/restore.js';

self.onmessage = ({ data }) => {
  try {
    const { image, details } = restore(data.image, data.options);
    self.postMessage({ ok: true, image, details }, [image.data.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: err.message || String(err) });
  }
};
