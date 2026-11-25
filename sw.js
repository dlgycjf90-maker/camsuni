/* 캠순이 서비스 워커(앱 2.14) — 신호가 없는 캠핑장에서도 앱을 열 수 있게 앱 파일만 이 기기에 보관한다.
   · 앱 화면(index.html): 인터넷 먼저 — 3.5초 안에 응답이 안 오면 보관본, 받을 때마다 보관본을 새것으로
   · Firebase 묶음(fb-sdk.<해시>.js)·아이콘: 보관본 먼저(이름에 해시가 있거나 거의 안 바뀜)
   · 장비 사진(gear/): 보관본 먼저, 3일 지난 보관본은 뒤에서 새로 받음 · 900장까지
   · ver.json(새 버전 확인)·다른 주소(Firebase 서버·날씨·글꼴·three.js)는 손대지 않음
   짐·배치 같은 자료는 여기서 보관하지 않는다(Firebase 가 이 기기 저장본에 따로 보관). */
'use strict';
const BUILD = "6957f18fd9e0";
const SHELL = 'cs-shell-' + BUILD, IMG = 'cs-img';
const BASE = new URL('./', self.location.href).href;
const SDK_RE = /fb-sdk\.[0-9a-f]{10}\.js/;
const NAV_WAIT = 3500, IMG_MAX = 900, IMG_AGE = 3 * 864e5;
const ICONS = ['manifest.webmanifest', 'icon-192.png', 'favicon-48.png', 'icon.svg', 'apple-touch-icon.png'];

/* 같은 화면을 가리키는 주소는 한 칸에: ?j=초대코드·#…는 빼고 index.html 은 폴더 주소로 */
function navKey(url) {
  const u = new URL(url);
  u.search = ''; u.hash = '';
  if (/\/index\.html$/.test(u.pathname)) u.pathname = u.pathname.replace(/index\.html$/, '');
  return u.href;
}
/* 다른 곳을 거쳐 온 응답은 화면 열기에 쓸 수 없어(브라우저가 막음) 새 응답으로 다시 만듦 */
function plain(r) {
  if (!r.redirected) return Promise.resolve(r);
  return r.blob().then(function (b) { return new Response(b, { status: r.status, statusText: r.statusText, headers: r.headers }); });
}

self.addEventListener('install', function (e) {
  /* 앱 화면과 그 화면이 부르는 Firebase 묶음을 같이 보관 — 묶음 이름은 받은 화면에서 읽어 서로 어긋나지 않게 */
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return fetch(BASE).then(function (r) {
      if (!r.ok) throw new Error('shell ' + r.status);
      return plain(r);
    }).then(function (r) {
      return r.clone().text().then(function (html) {
        const m = SDK_RE.exec(html), need = [c.put(BASE, r)];
        if (m) need.push(c.add(new URL(m[0], BASE).href));
        ICONS.forEach(function (f) { need.push(c.add(new URL(f, BASE).href).catch(function () { /* 아이콘은 없어도 앱은 열림 */ })); });
        return Promise.all(need);
      });
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('cs-shell-') === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET' || req.url.indexOf(BASE) !== 0) return;
  const rel = req.url.slice(BASE.length).split(/[?#]/)[0];
  if (req.mode === 'navigate') { e.respondWith(nav(e, req)); return; }
  if (rel === 'ver.json' || rel === 'sw.js') return;
  if (SDK_RE.test(rel) && rel.indexOf('/') < 0) { e.respondWith(cacheFirst(req, SHELL)); return; }
  if (ICONS.indexOf(rel) >= 0 || rel === 'icon-512.png' || rel === 'icon-512-maskable.png') { e.respondWith(cacheFirst(req, SHELL)); return; }
  if (/^gear\/(th\/)?[\w.-]+\.webp$/.test(rel)) e.respondWith(img(e, req));
});

function nav(e, req) {
  const key = navKey(req.url);
  let copy = null;
  const net = fetch(req).then(function (r) { if (r.ok && r.type === 'basic' && !r.redirected) copy = r.clone(); return r; });
  e.waitUntil(net.then(function () { return copy && caches.open(SHELL).then(function (c) { return c.put(key, copy); }); }).catch(function () { /* 다음에 다시 */ }));
  const saved = function () { return caches.open(SHELL).then(function (c) { return c.match(key).then(function (r) { return r || c.match(BASE); }); }); };
  return new Promise(function (res, rej) {
    let done = false;
    const give = function (r) { if (!done && r) { done = true; res(r); } };
    const t = setTimeout(function () { saved().then(give); }, NAV_WAIT);
    net.then(function (r) { clearTimeout(t); give(r); }, function (err) {
      clearTimeout(t);
      saved().then(function (r) { if (r) give(r); else if (!done) { done = true; rej(err); } });
    });
  });
}

function cacheFirst(req, name) {
  return caches.open(name).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || fetch(req).then(function (r) { if (r.ok && r.type === 'basic') c.put(req, r.clone()); return r; });
    });
  });
}

function img(e, req) {
  return caches.open(IMG).then(function (c) {
    const get = function () {
      return fetch(req).then(function (r) {
        if (r.ok && r.type === 'basic') { const cp = r.clone(); e.waitUntil(c.put(req, cp).then(function () { return trim(c); }).catch(function () { /* 저장 공간 부족 */ })); }
        return r;
      });
    };
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      if (!hit) return get();
      const d = Date.parse(hit.headers.get('date') || '') || 0;
      if (Date.now() - d > IMG_AGE) e.waitUntil(get().catch(function () { /* 오프라인 — 보관본 그대로 */ }));
      return hit;
    });
  });
}
function trim(c) {
  return c.keys().then(function (ks) { return ks.length > IMG_MAX ? Promise.all(ks.slice(0, ks.length - IMG_MAX).map(function (k) { return c.delete(k); })) : null; });
}
