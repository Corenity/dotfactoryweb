// 오프라인에서도 열리게 화면 파일을 휴대폰에 담아 둡니다. VERSION 은 손으로 올리지 않습니다 —
// 공개판 복사(tools/publish.mjs)가 화면 파일 내용으로 정한 값으로 바꿔 넣습니다.
const VERSION = 'dotfactory-web-f6a87c032e3e';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'icon.svg',
  'assets/bare/bare_arm_l.png', 'assets/bare/bare_arm_r.png',
  'assets/bare/bare_leg_l.png', 'assets/bare/bare_leg_r.png', 'assets/bare/bare_torso.png', 'assets/bare/face_frame.png',
  'css/app.css', 'css/paint.css', 'css/rig.css', 'css/motion.css', 'css/character.css',
  'js/app.js', 'js/nav.js', 'js/store.js', 'js/io.js', 'js/shrink-view.js', 'js/paint-view.js', 'js/slice-view.js', 'js/slice-library-view.js', 'js/rig-view.js', 'js/rig-slice-view.js', 'js/rig-auto-slice-view.js', 'js/rig-bones-view.js', 'js/rig-preset-view.js', 'js/motion-view.js', 'js/character-view.js', 'js/assemble-view.js', 'js/backdrop.js', 'js/restore-worker.js',
  'js/core/numeric.js', 'js/core/background.js', 'js/core/resample.js', 'js/core/restore.js', 'js/core/paint.js', 'js/core/select.js', 'js/core/assemble.js', 'js/core/gif.js', 'js/core/slice.js', 'js/core/auto-slice.js', 'js/core/rig.js', 'js/core/rig-render.js', 'js/core/motion.js', 'js/core/zip.js', 'js/core/godot-tscn.js', 'js/core/godot-export.js', 'js/core/rig-history.js', 'js/core/skeleton.js', 'js/core/animation.js', 'js/core/preset.js', 'js/core/rig-preset.js', 'js/core/preset-layers.js', 'js/core/preset-stack.js', 'js/core/rig-migrate.js', 'js/core/slice-library.js', 'js/core/role-flow.js', 'js/core/hash.js', 'js/core/character.js',
];

self.addEventListener('install', event => {
  // 휴대폰 HTTP 보관본(GitHub Pages 는 10분)을 건너뛰고 서버에서 받아 담습니다. 판이 섞이지 않게 합니다.
  event.waitUntil(caches.open(VERSION)
    .then(cache => cache.addAll(FILES.map(file => new Request(file, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 인터넷이 되면 새 파일을 받아 담고, 안 되면 담아 둔 파일을 씁니다. 받을 때는 휴대폰 HTTP 보관본을 그대로 쓰지 않고
// 서버에 바뀌었는지 물어봅니다(no-cache) — 안 바뀌었으면 짧은 답만 옵니다. 새 판을 올린 뒤 다시 열면 모든 파일이 새 것이 됩니다.
// 주소만 넘겨 새 요청을 만듭니다. 페이지 열기(navigate) 요청은 설정을 덧붙여 다시 만들 수 없습니다.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request.url, { cache: 'no-cache' })
    .then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(VERSION).then(cache => cache.put(event.request, copy)); }
      return response;
    })
    .catch(() => caches.match(event.request, { ignoreSearch: true })));
});
