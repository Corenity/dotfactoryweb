// 도트 공장 웹 — 큰 분류 셋과 서브탭으로 화면을 잇고 작업을 자동 저장합니다.
import { mountShrink } from './shrink-view.js';
import { mountPaint } from './paint-view.js';
import { mountSlice } from './slice-view.js';
import { mountRig } from './rig-view.js';
import { mountAssemble } from './assemble-view.js';
import { mountCharacter } from './character-view.js';
import { mountProfileView } from './profile-view.js';
import { mountNav } from './nav.js';
import { configureProfileAutosave, loadSaved, saveLater, saveVerifiedMigration } from './store.js';
import { ACTIVE_PROFILE, CURRENT_PROFILE, profileCanvasWarning, rememberProfileId } from './core/profile.js';
import {
  ROLE_STATE_VERSION,
  migrateLegacyAutosave,
  migrateRig1ToRoleState,
  motionRoleFromAutosave,
} from './core/role-flow.js';

const $ = sel => document.querySelector(sel);

const RIG_STEPS = {
  bones: 'rig',
  motion: 'motion',
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

let characterState = { barePreset: null, loadedPresets: [], animations: [], selectedMotion: '' };
let legacyExtra = {};
const startupWarnings = [];
try {
  const autosave = configureProfileAutosave(CURRENT_PROFILE.id, localStorage);
  rememberProfileId(localStorage, CURRENT_PROFILE.id);
  if (autosave.migration.reason === 'copy-failed') startupWarnings.push('옛 자동 보관을 복사하지 못해 원래 자료를 직접 읽습니다');
} catch (error) {
  startupWarnings.push(`기기 자동 보관을 준비하지 못했습니다: ${error.message}`);
}
if (ACTIVE_PROFILE.warning) startupWarnings.push(ACTIVE_PROFILE.warning);

const app = {
  show,
  toast,
  sendToPaint(image, name) { views.paint.load(image, name); show('paint'); },
  addToAssemble(image, name) { views.assemble.add(image, name); show('assemble'); toast(`합치기에 「${name}」을 더했습니다`); },
  getPieces() { return views.rig?.getPieces?.() || []; },
  getRigPreset() { return views.rig?.getPreset?.() || null; },
  getRigBasis() { return views.rig?.getBasis?.() || null; },
  getMotionBasis() { return views.rig?.getMotionBasis?.() || null; },
  getPresetStack() { return views.character?.getPresetStack?.() || null; },
  warnCanvas(canvas, label) {
    const warning = profileCanvasWarning(canvas, label);
    if (warning) toast(warning);
    return warning;
  },
  async loadLegacyRig(project) {
    const migrated = migrateRig1ToRoleState(project);
    if (migrated.report.verified !== true) throw new Error('옛 작업 파일을 안전하게 나눌 수 없습니다');
    await views.slice.restore(migrated.value.slice);
    await views.rig.restoreRole(migrated.value.rig);
    app.changed();
  },
  changed() {
    characterState = views.character?.snapshot?.() || characterState;
    saveLater({
      version: ROLE_STATE_VERSION,
      paint: views.paint.snapshot(),
      assemble: views.assemble.snapshot(),
      slice: views.slice.snapshot(),
      rig: views.rig.roleSnapshot(),
      motion: views.rig.motionRoleSnapshot(),
      character: characterState,
      legacyExtra,
    });
  },
};

const views = {
  shrink: mountShrink(app),
  paint: mountPaint(app),
  slice: mountSlice(app),
  rig: mountRig(app),
  assemble: mountAssemble(app),
  character: mountCharacter(app, {
    getRigBasis: () => views.rig?.getMotionBasis?.() || null,
  }),
};
mountProfileView(app);
if (startupWarnings.length) toast(startupWarnings.join(' / '));

// 머리 높이를 CSS 에 알려 줍니다. 화면을 돌려 높이가 바뀌어도 따라갑니다.
const header = $('.top');
new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${header.offsetHeight}px`)).observe(header);

// 지난번 작업을 되살립니다. 아이폰은 오래 안 쓴 사이트의 저장 자료를 지울 수 있어 내려받기가 기본입니다.
loadSaved().then(async saved => {
  if (!saved) return;
  if (saved.version == null) {
    const migrated = migrateLegacyAutosave(saved);
    if (migrated.report.verified !== true) throw new Error('옛 자동 보관 자료의 변환을 확인하지 못했습니다');
    saveVerifiedMigration(migrated);
    saved = migrated.value;
    toast('옛 자동 보관 자료를 안전하게 나누어 불러왔습니다');
  }
  if (saved.version !== ROLE_STATE_VERSION) throw new Error('이 자동 보관 자료의 판을 읽을 수 없습니다');
  const savedMotion = motionRoleFromAutosave(saved);
  characterState = saved.character || characterState;
  legacyExtra = saved.legacyExtra || {};
  if (saved.paint) await views.paint.restore(saved.paint);
  if (saved.slice) await views.slice.restore(saved.slice);
  if (saved.rig) await views.rig.restoreRole(saved.rig);
  await views.rig.restoreMotionRole(savedMotion);
  if (saved.assemble) await views.assemble.restore(saved.assemble);
  await views.character?.restore(characterState);
}).catch(error => {
  toast(`${error.message || '자동 보관 자료를 읽지 못했습니다'} 원본은 그대로 두었습니다`);
});

const initialTab = new URLSearchParams(location.search).get('tab') || location.hash.slice(1);
if (initialTab) show(initialTab);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
