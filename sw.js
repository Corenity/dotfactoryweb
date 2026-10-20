// 오프라인에서도 열리게 화면 파일을 휴대폰에 담아 둡니다. VERSION 은 손으로 올리지 않습니다 —
// 공개판 복사(tools/publish.mjs)가 화면 파일 내용으로 정한 값으로 바꿔 넣습니다.
const VERSION = 'dotfactory-web-17e0684fe347';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'icon.svg',
  'css/app.css', 'css/paint.css',
  'js/app.js', 'js/store.js', 'js/io.js', 'js/shrink-view.js', 'js/paint-view.js', 'js/assemble-view.js', 'js/restore-worker.js',
  'js/core/numeric.js', 'js/core/background.js', 'js/core/resample.js', 'js/core/restore.js', 'js/core/paint.js', 'js/core/assemble.js',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 인터넷이 되면 새 파일을 받아 담고, 안 되면 담아 둔 파일을 씁니다.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request)
    .then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(VERSION).then(cache => cache.put(event.request, copy)); }
      return response;
    })
    .catch(() => caches.match(event.request, { ignoreSearch: true })));
});
