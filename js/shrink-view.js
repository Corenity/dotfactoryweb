// 크기 화면 — 한 그림을 도트 칸 그림으로 줄이거나, 원래 칸을 그대로 정수 배로 키웁니다.
import { readImageFile, toCanvas, drawPixels, pickFiles, savePng, baseName, mountDesktopCanvasPan } from './io.js';
import { backdropToggle } from './backdrop.js';
import { dropKey } from './core/paint.js';
import { scaleNearest } from './core/scale.js';

const $ = sel => document.querySelector(sel);

export function mountShrink(app) {
  let source = null, sourceName = '', result = null, resultMode = '', resultFactor = 0, busy = false, mode = 'shrink';
  let panX = 0, panY = 0;
  const canvas = $('#shrink-out'), stage = canvas.parentElement;
  // 결과의 배경은 늘 투명 칸으로 받고, 초록은 보여 줄 때와 내려받을 때만 깝니다.
  const bg = backdropToggle($('#shrink-clear'), () => result && drawOut());
  mountDesktopCanvasPan(stage, {
    readPan: () => ({ x: panX, y: panY }),
    writePan: (x, y) => { panX = Math.round(x); panY = Math.round(y); if (result) drawOut(); },
    onResize: () => { if (result) drawOut(); },
  });

  const status = text => { $('#shrink-status').textContent = text; };

  $('#shrink-pick').addEventListener('click', async () => {
    const [file] = await pickFiles();
    if (!file) return;
    status('그림을 읽는 중…');
    try {
      source = await readImageFile(file);
      sourceName = baseName(file.name);
      $('#shrink-name').textContent = `${file.name} · ${source.width}×${source.height}`;
      $('#shrink-run').disabled = false;
      result = null;
      panX = panY = 0;
      $('#shrink-result').hidden = true;
      status('');
    } catch (err) {
      status(`읽지 못했습니다: ${err.message}`);
    }
  });

  function setMode(next) {
    if (busy) return;
    mode = next;
    const shrinking = mode === 'shrink';
    $('#shrink-mode-shrink').setAttribute('aria-pressed', String(shrinking));
    $('#shrink-mode-grow').setAttribute('aria-pressed', String(!shrinking));
    $('#shrink-mode-shrink').classList.toggle('primary', shrinking);
    $('#shrink-mode-grow').classList.toggle('primary', !shrinking);
    $('#shrink-options').hidden = !shrinking;
    $('#grow-options').hidden = shrinking;
    $('#shrink-run').textContent = shrinking ? '축소' : '확대';
    result = null;
    panX = panY = 0;
    $('#shrink-result').hidden = true;
    status('');
  }

  $('#shrink-mode-shrink').addEventListener('click', () => setMode('shrink'));
  $('#shrink-mode-grow').addEventListener('click', () => setMode('grow'));

  $('#shrink-run').addEventListener('click', () => {
    if (!source || busy) return;
    if (mode === 'grow') {
      try {
        const factor = Number($('#grow-scale').value);
        result = scaleNearest(dropKey(source), factor);
        resultMode = 'grow';
        resultFactor = factor;
        status('끝났습니다');
        showGrowResult(factor);
      } catch (err) {
        result = null;
        $('#shrink-result').hidden = true;
        status(`확대하지 못했습니다: ${err.message}`);
      }
      return;
    }
    const options = {
      targetHeight: Number($('#shrink-height').value) || 56,
      transparent: true,
      canvasW: Number($('#shrink-w').value) || 72,
      canvasH: Number($('#shrink-h').value) || 64,
      centerX: Number($('#shrink-cx').value),
      footY: Number($('#shrink-fy').value),
    };
    busy = true;
    $('#shrink-run').disabled = true;
    status('축소하는 중…');
    const started = performance.now();
    const worker = new Worker(new URL('./restore-worker.js', import.meta.url), { type: 'module' });
    const copy = { width: source.width, height: source.height, data: new Uint8ClampedArray(source.data) };
    worker.onmessage = ({ data }) => {
      worker.terminate();
      busy = false;
      $('#shrink-run').disabled = false;
      if (!data.ok) { status(`축소하지 못했습니다: ${data.error}`); return; }
      result = data.image;
      resultMode = 'shrink';
      status(`끝났습니다 (${((performance.now() - started) / 1000).toFixed(1)}초)`);
      showShrinkResult(data.details);
    };
    worker.onerror = err => {
      worker.terminate();
      busy = false;
      $('#shrink-run').disabled = false;
      status(`축소하지 못했습니다: ${err.message || '알 수 없는 오류'}`);
    };
    worker.postMessage({ image: copy, options }, [copy.data.buffer]);
  });

  function showShrinkResult(details) {
    $('#shrink-result').hidden = false;
    $('#shrink-guide-wrap').hidden = false;
    $('#shrink-to-paint').hidden = false;
    $('#shrink-to-assemble').hidden = false;
    drawGuide(details);
    drawOut();
    const [w, h] = details.canvas;
    $('#shrink-info').textContent = `${w}×${h} 칸 · 원본 ${details.perCell.toFixed(1)}px 가 한 칸`;
  }

  function showGrowResult(factor) {
    $('#shrink-result').hidden = false;
    $('#shrink-guide-wrap').hidden = true;
    $('#shrink-to-paint').hidden = true;
    $('#shrink-to-assemble').hidden = true;
    drawOut();
    $('#shrink-info').textContent = `${result.width}×${result.height}px · 원본 한 칸을 ${factor}×${factor}px로 확대`;
  }

  function drawOut() {
    drawPixels(canvas, result, resultMode === 'grow' ? 1 : 4, bg.backdrop);
    canvas.style.transform = `translate(${panX}px, ${panY}px)`;
  }

  // PC 「기준 보기」와 같은 색으로 잰 기준을 원본 위에 그립니다.
  function drawGuide(d) {
    const canvas = $('#shrink-guide');
    const scale = Math.min(1, 720 / Math.max(source.width, source.height));
    canvas.width = Math.round(source.width * scale);
    canvas.height = Math.round(source.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(toCanvas(source), 0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 3;
    const rect = (box, color) => { ctx.strokeStyle = color; ctx.strokeRect(box[0] * scale, box[1] * scale, (box[2] - box[0]) * scale, (box[3] - box[1]) * scale); };
    rect(d.crop, '#ffffff');
    rect(d.mainBox, '#3dd673');
    for (const box of d.excluded) rect(box, '#ff5353');
    ctx.strokeStyle = '#409cff';
    ctx.beginPath(); ctx.moveTo(d.bodyAxis * scale, d.crop[1] * scale); ctx.lineTo(d.bodyAxis * scale, d.crop[3] * scale); ctx.stroke();
    ctx.strokeStyle = '#ffd040';
    ctx.beginPath(); ctx.moveTo(d.crop[0] * scale, d.foot * scale); ctx.lineTo(d.crop[2] * scale, d.foot * scale); ctx.stroke();
  }

  $('#shrink-save').addEventListener('click', () => {
    if (!result) return;
    const suffix = resultMode === 'grow' ? `${resultFactor}배` : '도트';
    savePng(`${sourceName}_${suffix}.png`, bg.forSave(result));
  });
  $('#shrink-to-paint').addEventListener('click', () => resultMode === 'shrink' && app.sendToPaint(result, `${sourceName}_도트`));
  $('#shrink-to-assemble').addEventListener('click', () => resultMode === 'shrink' && app.addToAssemble(result, `${sourceName}_도트`));

  return {};
}
