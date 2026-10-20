// 자동 저장 — 브라우저 저장소(localStorage)에 마지막 작업 하나를 둡니다. 내려받기를 대신하지 않습니다.
const KEY = 'dotfactory-web/autosave-1';
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
