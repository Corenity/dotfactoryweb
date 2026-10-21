// 자동 저장 — 브라우저 저장소(localStorage)에 마지막 작업 하나를 둡니다. 내려받기를 대신하지 않습니다.
import { cleanColors } from './core/paint.js';

const KEY = 'dotfactory-web/autosave-1';
// 내 색은 그림과 따로 둡니다. 새 그림을 열어도 남지만, 아이폰이 사이트 자료를 지우면 함께 사라질 수 있습니다.
const COLORS_KEY = 'dotfactory-web/my-colors-1';
let timer = 0;

export function saveLater(value) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* 저장소가 가득 차면 자동 저장만 건너뜁니다 */ }
  }, 800);
}

export async function loadSaved() {
  const text = localStorage.getItem(KEY);
  return text ? JSON.parse(text) : null;
}

export function loadColors() {
  try { return cleanColors(JSON.parse(localStorage.getItem(COLORS_KEY) || '[]')); } catch { return []; }
}

export function saveColors(list) {
  try { localStorage.setItem(COLORS_KEY, JSON.stringify(list)); } catch { /* 저장소가 가득 차면 이번 판에서만 남습니다 */ }
}
