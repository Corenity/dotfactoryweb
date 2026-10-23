// 뼈 애니메이션 4단계 — project-c용 ZIP 내려받기와 가져오기 보고입니다.
import { makeGodotExport } from './core/godot-export.js';
import { saveFile } from './io.js';

const $ = selector => document.querySelector(selector);

export function mountRigExport(app, model) {
  const panel = $('#rig-export-panel');
  const report = $('#rig-import-report');

  $('#rig-save-godot').addEventListener('click', async () => {
    try {
      const made = makeGodotExport(model.getProject());
      const result = await saveFile('dotfactory-godot.zip', new Blob([made.bytes], { type: 'application/zip' }));
      if (result !== 'cancelled') app.toast('「dotfactory-godot.zip」을 만들었습니다');
    } catch (err) {
      app.toast(err.message || '고도용 ZIP을 만들 수 없습니다');
    }
  });

  return {
    show() { panel.hidden = false; },
    hide() { panel.hidden = true; },
    report(source, warnings = []) {
      report.textContent = warnings.length
        ? `「${source}」에서 확인할 내용 ${warnings.length}개\n${warnings.map(item => `• ${item}`).join('\n')}`
        : `「${source}」의 뼈와 움직임을 모두 읽었습니다.`;
    },
    clearReport() { report.textContent = 'TSCN이나 ZIP을 열면 가져온 결과를 여기에 적습니다.'; },
  };
}
