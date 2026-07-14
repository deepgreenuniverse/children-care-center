// Service Worker — 小树苗看护
// 职责：注册后台提醒 + 离线缓存 + 跨机型通知触发

const CACHE = 'xiaoshumiao-v2';
const PRECACHE = ['./manifest.json'];

// 安装：预缓存核心文件
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 消息通道：主页面通过 postMessage 调度提醒
self.addEventListener('message', e => {
  const { type, payload } = e.data || {};
  if (type === 'SCHEDULE') scheduleReminder(payload);
  if (type === 'CANCEL') cancelReminder(payload.id);
});

const timers = new Map();

function scheduleReminder({ id, title, body, fireAt, sound }) {
  cancelReminder(id);
  const delay = Math.max(0, fireAt - Date.now());
  // < 24h 用 setTimeout，否则用 setTimeout 链（避免 32-bit int 溢出）
  const t = setTimeout(() => fire(id, title, body, sound), Math.min(delay, 2147483647));
  timers.set(id, t);
}

function cancelReminder(id) {
  const t = timers.get(id);
  if (t) { clearTimeout(t); timers.delete(id); }
}

function fire(id, title, body, sound) {
  timers.delete(id);
  const opts = {
    body: body || '',
    tag: id,
    requireInteraction: true,
    renotify: true,
  };
  // icon 必须用 https URL，data URL 在 SW 通知里部分浏览器不支持
  self.registration.showNotification(title || '小树苗看护', opts).catch(err => {
    console.error('[SW] showNotification 失败:', err);
  });
}

// 点击通知：唤醒主页面
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => {
        for (const c of list) {
          if (c.url.includes('index.html')) return c.focus();
        }
        return self.clients.openWindow('./index.html');
      })
  );
});

// 网络：只缓存静态资源，index.html 永远走网络（避免更新被 SW 缓存挡住）
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // 非 http(s) 请求（data:, blob:, chrome-extension: 等）直接放行
  const url = e.request.url;
  if (!url.startsWith('http')) return;
  const u = new URL(url);
  if (u.pathname.endsWith('.html') || u.pathname === '/') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});