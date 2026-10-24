// 工工四を撮ると鳴る — 一度開けば電波のない所でも使えるように保存する
const CACHE = "kunkunshi-957f29a704";
const FILES = ["./", "index.html", "youshi.html", "youshi.pdf", "sample.jpg", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png", "vendor/pdfjs/pdf.min.mjs", "vendor/pdfjs/pdf.worker.min.mjs"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("kunkunshi-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url), scope = new URL(self.registration.scope);
  const mine = url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
  const font = FONT_HOSTS.includes(url.hostname);
  if (!mine && !font) return;
  if (e.request.mode === "navigate") {
    // ページはネットを先に見て、4秒でつながらなければ保存分
    e.respondWith(Promise.race([
      // ブラウザに残った古いページを使わず、必ずサーバーに新しい版を確かめる
      fetch(new Request(e.request.url, { cache: "no-cache", credentials: "same-origin" }))
        .then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; }),
      new Promise((_, rej) => setTimeout(rej, 4000))
    ]).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok || r.type === "opaque") { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); }
    return r;
  })));
});
