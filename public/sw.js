/* App shell only. Imported game files are handled by the page and never cached here. */
const CACHE = 'harbor-master-shell-v4';
const ROOT = new URL('./', self.registration.scope);
const SHELL = ROOT.href;
const appAsset = (url) => {
  if (url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return false;
  const path = url.pathname.slice(ROOT.pathname.length);
  return /^assets\/[A-Za-z0-9_./-]+\.(?:js|css|woff2?|svg|png)$/i.test(path) ||
    /^(?:manifest\.webmanifest|icon(?:-maskable)?-(?:192|512)\.png|icon\.svg)$/.test(path);
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch(SHELL, { cache: 'reload' });
    if (!response.ok) throw new Error('Could not cache the app shell');
    const html = await response.clone().text();
    await cache.put(SHELL, response);
    const paths = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(match => new URL(match[1], ROOT))
      .filter(appAsset);
    const defaults = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']
      .map(path => new URL(path, ROOT));
    await Promise.allSettled([...paths, ...defaults].map(async (url) => {
      const asset = await fetch(url.href, { cache: 'reload' });
      if (asset.ok) await cache.put(url.href, asset);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('harbor-master-shell-') && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(SHELL, response.clone());
        return response;
      } catch {
        return (await cache.match(SHELL)) || Response.error();
      }
    })());
    return;
  }
  if (!appAsset(url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
