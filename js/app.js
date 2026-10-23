// 도트 공장 웹 — 큰 분류 셋과 서브탭으로 화면을 잇고 작업을 자동 저장합니다.
import { mountShrink } from './shrink-view.js';
import { mountPaint } from './paint-view.js';
import { mountRig } from './rig-view.js';
import { mountAssemble } from './assemble-view.js';
import { mountPreset } from './preset-view.js';
import { mountNav } from './nav.js';
import { loadSaved, saveLater } from './store.js';

const $ = sel => document.querySelector(sel);

const RIG_STEPS = {
  slice: 'slice',
  bones: 'rig',
  motion: 'motion',
  export: 'export',
};

let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function switchView(tab) {
  const rigStep = RIG_STEPS[tab];
  const rigView = document.querySelector('[data-view="rig"]');
  const wasRigHidden = !rigView || rigView.hidden;

  for (const v of document.querySelectorAll('[data-view]')) {
    if (rigStep) {
      v.hidden = v.dataset.view !== 'rig';
    } else {
      v.hidden = v.dataset.view !== tab;
    }
  }

  if (rigStep) {
    if (wasRigHidden) {
      views.rig.shown?.();
    }
    views.rig.setStep(rigStep);
  } else {
    views[tab]?.shown?.();
  }
}

const nav = mountNav({
  onSwitch: (subtab) => switchView(subtab),
});

function show(tab) {
  nav.show(tab);
}

const app = {
  show,
  toast,
  sendToPaint(image, name) { views.paint.load(image, name); show('paint'); },
  addToAssemble(image, name) { views.assemble.add(image, name); show('assemble'); toast(`합치기에 「${name}」을 더했습니다`); },
  getPieces() { return views.rig?.getPieces?.() || []; },
  getPresetStack() { return views.preset?.getPresetStack?.() || null; },
  changed() {
    saveLater({
      paint: views.paint.snapshot(),
      rig: views.rig.snapshot(),
      assemble: views.assemble.snapshot(),
      preset: views.preset?.snapshot(),
    });
  },
};

const views = {
  shrink: mountShrink(app),
  paint: mountPaint(app),
  rig: mountRig(app),
  assemble: mountAssemble(app),
  preset: mountPreset(app),
};

// 머리 높이를 CSS 에 알려 줍니다. 화면을 돌려 높이가 바뀌어도 따라갑니다.
const header = $('.top');
new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${header.offsetHeight}px`)).observe(header);

// 지난번 작업을 되살립니다. 아이폰은 오래 안 쓴 사이트의 저장 자료를 지울 수 있어 내려받기가 기본입니다.
loadSaved().then(async saved => {
  if (!saved) return;
  if (saved.paint) await views.paint.restore(saved.paint);
  if (saved.rig) await views.rig.restore(saved.rig);
  if (saved.assemble) await views.assemble.restore(saved.assemble);
  if (saved.preset) await views.preset?.restore(saved.preset);
}).catch(() => {});

const initialTab = new URLSearchParams(location.search).get('tab') || location.hash.slice(1);
if (initialTab) show(initialTab);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
