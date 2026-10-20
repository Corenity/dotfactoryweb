// 투명화 단추 — 화면마다 하나씩 둡니다. 처음은 늘 초록 배경이고, 누를 때마다 초록 ↔ 투명(체크무늬)이 바뀝니다.
// 그림 안의 배경은 늘 투명이라 단추를 눌러도 그림은 바뀌지 않습니다. 내려받을 때만 지금 배경을 따라 초록을 채웁니다.
import { KEY, fillKey, toHex } from './core/paint.js';

export function backdropToggle(button, onChange) {
  let clear = false;
  const show = () => button.setAttribute('aria-pressed', String(clear));
  button.addEventListener('click', () => { clear = !clear; show(); onChange(); });
  show();
  return {
    /** 그릴 때 깔 바탕 — drawPixels 의 backdrop 값입니다. */
    get backdrop() { return clear ? 'checker' : toHex(KEY); },
    /** 내려받을 그림 — 초록 배경이면 투명 칸을 초록으로 채웁니다. */
    forSave: img => (clear ? img : fillKey(img)),
  };
}
