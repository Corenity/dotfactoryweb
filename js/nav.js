// 상단 2줄 네비게이션 — 큰 분류(이미지·애니메이션·캐릭터)와 서브탭 간의 전환을 관리합니다.

export const SUBTAB_CATEGORY = {
  shrink: 'image',
  paint: 'image',
  slice: 'image',
  assemble: 'image',
  bones: 'animation',
  motion: 'animation',
  preset: 'character',
  export: 'character',
};

export const CATEGORY_DEFAULTS = {
  image: 'shrink',
  animation: 'bones',
  character: 'preset',
};

export const TAB_ALIASES = {
  rig: 'slice',
  play: 'export',
  export: 'export',
  다듬기: 'paint',
  편집: 'paint',
  축소: 'shrink',
  자르기: 'slice',
  합치기: 'assemble',
  뼈대: 'bones',
  키잡기: 'motion',
  움직임: 'motion',
  뽑기: 'export',
  플레이: 'export',
  프리셋: 'preset',
};

export function mountNav({ onSwitch }) {
  let currentCategory = 'image';
  let currentSubtab = 'shrink';
  const categoryMemory = { ...CATEGORY_DEFAULTS };

  const catButtons = document.querySelectorAll('.nav-categories [data-category]');
  const subGroups = document.querySelectorAll('.nav-subtabs [data-for-category]');
  const subButtons = document.querySelectorAll('.nav-subtabs [data-tab]');

  function updateUI(category, subtab) {
    for (const b of catButtons) {
      b.setAttribute('aria-selected', String(b.dataset.category === category));
    }
    for (const g of subGroups) {
      g.hidden = g.dataset.forCategory !== category;
    }
    for (const b of subButtons) {
      b.setAttribute('aria-selected', String(b.dataset.tab === subtab));
    }
  }

  function switchTo(target) {
    const resolved = TAB_ALIASES[target] || target;
    const category = SUBTAB_CATEGORY[resolved];
    if (!category) return false;

    currentCategory = category;
    currentSubtab = resolved;
    categoryMemory[category] = resolved;

    updateUI(currentCategory, currentSubtab);
    onSwitch?.(currentSubtab, currentCategory);
    return true;
  }

  for (const b of catButtons) {
    b.addEventListener('click', () => {
      const cat = b.dataset.category;
      const targetSubtab = categoryMemory[cat] || CATEGORY_DEFAULTS[cat];
      switchTo(targetSubtab);
    });
  }

  for (const b of subButtons) {
    b.addEventListener('click', () => {
      switchTo(b.dataset.tab);
    });
  }

  updateUI(currentCategory, currentSubtab);

  return {
    show: switchTo,
    getCurrentTab: () => currentSubtab,
    getCurrentCategory: () => currentCategory,
  };
}
