// 축소 화면 — 큰 그림을 골라 도트 칸 그림으로 줄이고, 잰 기준(몸 중심 · 발 위치 · 범위)을 함께 보여 줍니다.
import { readImageFile, toCanvas, drawPixels, pickFiles, savePng, baseName } from './io.js';
import { backdropToggle } from './backdrop.js';

const $ = sel => document.querySelector(sel);

export function mountShrink(app) {
  let source = null, sourceName = '', result = null, busy = false;
  // 축소 결과의 배경은 늘 투명 칸으로 받고, 초록은 보여 줄 때와 내려받을 때만 깝니다.
  const bg = backdropToggle($('#shrink-clear'), () => result && drawOut());

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
      $('#shrink-result').hidden = true;
      status('');
    } catch (err) {
      status(`읽지 못했습니다: ${err.message}`);
    }
  });

  $('#shrink-run').addEventListener('click', () => {
    if (!source || busy) return;
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
      status(`끝났습니다 (${((performance.now() - started) / 1000).toFixed(1)}초)`);
      showResult(data.details);
    };
    worker.onerror = err => {
      worker.terminate();
      busy = false;
      $('#shrink-run').disabled = false;
      status(`축소하지 못했습니다: ${err.message || '알 수 없는 오류'}`);
    };
    worker.postMessage({ image: copy, options }, [copy.data.buffer]);
  });

  function showResult(details) {
    $('#shrink-result').hidden = false;
    drawGuide(details);
    drawOut();
    const [w, h] = details.canvas;
    $('#shrink-info').textContent = `${w}×${h} 칸 · 원본 ${details.perCell.toFixed(1)}px 가 한 칸`;
  }

  function drawOut() { drawPixels($('#shrink-out'), result, 4, bg.backdrop); }

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

  $('#shrink-save').addEventListener('click', () => result && savePng(`${sourceName}_도트.png`, bg.forSave(result)));
  $('#shrink-to-paint').addEventListener('click', () => result && app.sendToPaint(result, `${sourceName}_도트`));
  $('#shrink-to-assemble').addEventListener('click', () => result && app.addToAssemble(result, `${sourceName}_도트`));

  return {};
}
