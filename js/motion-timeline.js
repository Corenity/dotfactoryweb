// 키잡기 타임라인 — 뼈마다 키 줄, 시간 눈금, 빨간 시간 막대와 키 말풍선을 그립니다.
import { frameTimes, hasKey } from './core/motion.js';

export const TIMELINE_NAME_WIDTH = 56;
export const TIMELINE_RULER_HEIGHT = 44;
export const TIMELINE_ROW_HEIGHT = 30;
export const TIMELINE_MIN_CELL = 30;
const INDENT = 8;

/** 부모가 먼저 오고 자식은 부모 깊이보다 한 칸 들여 쓴 줄 순서를 만듭니다. */
export function timelineRows(bones) {
  const names = new Set(bones.map(bone => bone.name));
  const children = new Map();
  for (const bone of bones) {
    const parent = names.has(bone.parent) ? bone.parent : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(bone.name);
  }
  const rows = [], seen = new Set();
  const visit = (name, depth) => {
    if (seen.has(name)) return;
    seen.add(name);
    rows.push({ name, depth });
    for (const child of children.get(name) || []) visit(child, depth + 1);
  };
  for (const root of children.get(null) || []) visit(root, 0);
  for (const bone of bones) visit(bone.name, 0);
  return rows;
}

/** 칸이 적으면 남는 폭을 나눠 갖고, 많으면 최소 30px로 두어 옆으로 밀어 봅니다. */
export function timelineCellWidth(count, available) {
  return Math.max(TIMELINE_MIN_CELL, Math.floor(Math.max(0, available) / Math.max(1, count)));
}

export function timelineIndexAt(x, width, count) {
  return Math.max(0, Math.min(Math.max(0, count - 1), Math.floor(x / width)));
}

/** 눈금 글자가 겹치지 않게 몇 칸마다 적을지 정합니다. */
export function timelineTickEvery(width) {
  return Math.max(1, Math.ceil(40 / width));
}

/** 붙박이 눈금 아래에 줄이 다 보이도록 세로 밀기 값을 정합니다. */
export function timelineRevealTop(scrollTop, viewHeight, rowTop, rowHeight = TIMELINE_ROW_HEIGHT, stickyTop = TIMELINE_RULER_HEIGHT) {
  if (rowTop - stickyTop < scrollTop) return Math.max(0, rowTop - stickyTop);
  if (rowTop + rowHeight > scrollTop + viewHeight) return rowTop + rowHeight - viewHeight;
  return scrollTop;
}

/** 붙박이 뼈 이름 칸 옆에 칸이 다 보이도록 가로 밀기 값을 정합니다. */
export function timelineRevealLeft(scrollLeft, viewWidth, cellLeft, cellWidth, stickyLeft = TIMELINE_NAME_WIDTH) {
  if (cellLeft - stickyLeft < scrollLeft) return Math.max(0, cellLeft - stickyLeft);
  if (cellLeft + cellWidth > scrollLeft + viewWidth) return cellLeft + cellWidth - viewWidth;
  return scrollLeft;
}

const formatTick = time => String(Number(time.toFixed(3)));

export function mountMotionTimeline(els, hooks) {
  const { scroller, grid, corner, boneAdd, pop, addKey, posKey, rotKey, dropKey } = els;
  let width = TIMELINE_MIN_CELL;
  let times = [];
  let pending = null;
  let head = null, mark = null;

  const slotIndex = time => {
    const index = times.findIndex(value => Math.abs(value - time) <= 1e-7);
    return index < 0 ? 0 : index;
  };
  const lane = name => [...grid.querySelectorAll('.motion-lane')].find(item => item.dataset.bone === name);

  function moveHead(reveal = false) {
    if (!head) return;
    const index = slotIndex(hooks.read().time);
    const center = (index + 0.5) * width;
    head.style.left = `${TIMELINE_NAME_WIDTH + center}px`;
    mark.style.left = `${center}px`;
    if (reveal) scroller.scrollLeft = timelineRevealLeft(scroller.scrollLeft, scroller.clientWidth, TIMELINE_NAME_WIDTH + index * width, width);
  }

  function render() {
    const { ready, bones, motion, selected, time } = hooks.read();
    for (const child of [...grid.children]) if (child !== corner) child.remove();
    head = mark = null;
    boneAdd.classList.toggle('primary', !ready);
    times = motion ? frameTimes(motion) : [];
    const available = (scroller.clientWidth || 320) - TIMELINE_NAME_WIDTH - 2;
    width = timelineCellWidth(times.length || 1, available);
    const lanesWidth = Math.max(available, (times.length || 1) * width);
    grid.style.setProperty('--lanes', `${lanesWidth}px`);
    grid.style.setProperty('--cell', `${width}px`);

    const ruler = document.createElement('div');
    ruler.className = 'motion-keys-ruler';
    const every = timelineTickEvery(width);
    times.forEach((value, index) => {
      if (index % every) return;
      const tick = document.createElement('span');
      tick.textContent = formatTick(value);
      tick.style.left = `${(index + 0.5) * width}px`;
      ruler.append(tick);
    });
    grid.append(ruler);

    const rows = ready ? timelineRows(bones) : [];
    if (!ready || !motion || !rows.length) {
      const guide = document.createElement('p');
      guide.className = 'motion-keys-empty';
      guide.textContent = !ready || !rows.length
        ? '「뼈 +」로 뼈 파일을 열면 여기에 뼈마다 키 줄이 생깁니다.'
        : '애니메이션이 없습니다. 「idle ▾」 목록의 「추가」로 다시 시작할 수 있습니다.';
      grid.append(document.createElement('span'), guide);
      close();
      return;
    }

    mark = document.createElement('i');
    mark.className = 'motion-head-mark';
    ruler.append(mark);
    const current = slotIndex(time);
    for (const row of rows) {
      const on = row.name === selected;
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'motion-keys-name' + (on ? ' on' : '');
      name.dataset.bone = row.name;
      name.textContent = row.name;
      name.title = row.name;
      name.style.paddingLeft = `${4 + row.depth * INDENT}px`;
      const track = document.createElement('div');
      track.className = 'motion-lane' + (on ? ' on' : '');
      track.dataset.bone = row.name;
      times.forEach((value, index) => {
        if (!hasKey(motion, row.name, value)) return;
        const key = document.createElement('button');
        key.type = 'button';
        key.className = 'motion-key' + (on && index === current ? ' selected' : '');
        key.dataset.index = String(index);
        key.style.left = `${index * width}px`;
        key.style.width = `${width}px`;
        key.setAttribute('aria-label', `${row.name} ${formatTick(value)}초 키`);
        track.append(key);
      });
      grid.append(name, track);
    }
    head = document.createElement('div');
    head.className = 'motion-head';
    grid.append(head);
    moveHead();
    if (pending) placePop();
  }

  function close() {
    pending = null;
    pop.hidden = true;
    grid.querySelector('.motion-cell-pending')?.remove();
  }

  function placePop() {
    const { motion, bar } = hooks.read();
    const track = lane(pending.bone);
    if (!motion || !track || pending.index >= times.length) { close(); return; }
    const keyed = hasKey(motion, pending.bone, times[pending.index]);
    let anchor = track.querySelector(`.motion-key[data-index="${pending.index}"]`);
    track.querySelector('.motion-cell-pending')?.remove();
    if (!anchor) {
      anchor = document.createElement('span');
      anchor.className = 'motion-cell-pending';
      anchor.style.left = `${pending.index * width}px`;
      anchor.style.width = `${width}px`;
      track.append(anchor);
    }
    addKey.hidden = keyed;
    for (const button of [posKey, rotKey, dropKey]) button.hidden = !keyed;
    posKey.setAttribute('aria-pressed', String(bar === 'P'));
    rotKey.setAttribute('aria-pressed', String(bar === 'R'));
    pop.hidden = false;
    const rect = anchor.getBoundingClientRect(), view = scroller.getBoundingClientRect();
    if (rect.right <= view.left + TIMELINE_NAME_WIDTH || rect.left >= view.right || rect.bottom <= view.top + TIMELINE_RULER_HEIGHT || rect.top >= view.bottom) { close(); return; }
    const popWidth = pop.offsetWidth, popHeight = pop.offsetHeight;
    const left = Math.max(4, Math.min(window.innerWidth - popWidth - 4, rect.left + rect.width / 2 - popWidth / 2));
    const below = rect.top - popHeight - 8 < 4;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(below ? rect.bottom + 8 : rect.top - popHeight - 8)}px`;
    pop.style.setProperty('--ax', `${Math.round(rect.left + rect.width / 2 - left)}px`);
    pop.classList.toggle('below', below);
  }

  function open(bone, index) {
    pending = { bone, index };
    hooks.seek(bone, times[index]);
  }

  grid.addEventListener('click', event => {
    const key = event.target.closest('.motion-key');
    if (key) { open(key.parentElement.dataset.bone, Number(key.dataset.index)); return; }
    const track = event.target.closest('.motion-lane');
    if (track) {
      const rect = track.getBoundingClientRect();
      open(track.dataset.bone, timelineIndexAt(event.clientX - rect.left, width, times.length));
      return;
    }
    const name = event.target.closest('.motion-keys-name');
    if (name) { close(); hooks.selectBone(name.dataset.bone); return; }
    const ruler = event.target.closest('.motion-keys-ruler');
    if (ruler && times.length) {
      close();
      hooks.seek(null, times[timelineIndexAt(event.clientX - ruler.getBoundingClientRect().left, width, times.length)]);
    }
  });
  document.addEventListener('pointerdown', event => {
    if (pending && !pop.contains(event.target)) close();
  }, true);
  scroller.addEventListener('scroll', () => { if (pending) placePop(); });
  window.addEventListener('resize', close);
  addKey.addEventListener('click', () => hooks.addKey());
  posKey.addEventListener('click', () => { hooks.openBar('P'); if (pending) placePop(); });
  rotKey.addEventListener('click', () => { hooks.openBar('R'); if (pending) placePop(); });
  dropKey.addEventListener('click', () => { close(); hooks.dropKey(); });

  return {
    render,
    moveHead,
    close,
    reveal(name) {
      const row = [...grid.querySelectorAll('.motion-keys-name')].find(item => item.dataset.bone === name);
      if (row) scroller.scrollTop = timelineRevealTop(scroller.scrollTop, scroller.clientHeight, row.offsetTop);
    },
  };
}
