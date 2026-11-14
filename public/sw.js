/* App shell only. Imported game files are handled by the page and never cached here. */
// The production build replaces the placeholder with a hash of the shell.
const CACHE = 'harbor-master-shell-v5-__SHELL_VERSION__';
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
    try {
      const response = await fetch(SHELL, { cache: 'reload' });
      if (!response.ok) throw new Error('Could not cache the app shell');
      const html = await response.clone().text();
      const paths = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
        .map(match => new URL(match[1], ROOT))
        .filter(appAsset);
      const defaults = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']
        .map(path => new URL(path, ROOT));
      const urls = [...new Set([...paths, ...defaults].map(url => url.href))];
      await Promise.all(urls.map(async (url) => {
        const asset = await fetch(url, { cache: 'reload' });
        if (!asset.ok) throw new Error(`Could not cache ${url}`);
        await cache.put(url, asset);
      }));
      // Publish the shell only after every asset is safely cached.
      await cache.put(SHELL, response);
      await self.skipWaiting();
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
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
    // These are same-origin, versioned static assets. Hosts may send Vary:
    // Origin, while the install fetch has no Origin and module requests do.
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
