// 도트 공장 웹 — 세 화면(축소 · 다듬기 · 합치기)을 잇고, 작업을 자동 저장합니다.
import { mountShrink } from './shrink-view.js';
import { mountPaint } from './paint-view.js';
import { mountAssemble } from './assemble-view.js';
import { loadSaved, saveLater } from './store.js';

const $ = sel => document.querySelector(sel);

function show(tab) {
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const v of document.querySelectorAll('[data-view]')) v.hidden = v.dataset.view !== tab;
  views[tab]?.shown?.();
}

let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

const app = {
  show,
  toast,
  sendToPaint(image, name) { views.paint.load(image, name); show('paint'); },
  addToAssemble(image, name) { views.assemble.add(image, name); show('assemble'); toast(`합치기에 「${name}」을 더했습니다`); },
  changed() { saveLater({ paint: views.paint.snapshot(), assemble: views.assemble.snapshot() }); },
};

const views = {
  shrink: mountShrink(app),
  paint: mountPaint(app),
  assemble: mountAssemble(app),
};

for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => show(b.dataset.tab));

// 다듬기 도구 줄이 위쪽 머리 바로 아래에 붙도록 머리 높이를 CSS 에 알려 줍니다. 화면을 돌려 높이가 바뀌어도 따라갑니다.
const header = $('.top');
new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${header.offsetHeight}px`)).observe(header);

// 지난번 작업을 되살립니다. 아이폰은 오래 안 쓴 사이트의 저장 자료를 지울 수 있어 내려받기가 기본입니다.
loadSaved().then(async saved => {
  if (!saved) return;
  if (saved.paint) await views.paint.restore(saved.paint);
  if (saved.assemble) await views.assemble.restore(saved.assemble);
}).catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
