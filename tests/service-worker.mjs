import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile('public/sw.js', 'utf8');
const origin = 'https://example.test/';
const cacheName = 'harbor-master-shell-v5-__SHELL_VERSION__';
const html = '<script src="/assets/app.js"></script><link href="/assets/app.css">';

function worker(failPath) {
  const handlers = {};
  const cacheMaps = new Map([['harbor-master-shell-v4', new Map([[origin, new Response('old shell')]])]]);
  let skipped = false;
  let matchOptions;
  const caches = {
    async open(name) {
      if (!cacheMaps.has(name)) cacheMaps.set(name, new Map());
      const entries = cacheMaps.get(name);
      return {
        async put(request, response) { entries.set(typeof request === 'string' ? request : request.url, response); },
        async match(request, options) {
          matchOptions = options;
          return entries.get(typeof request === 'string' ? request : request.url);
        },
      };
    },
    async delete(name) { return cacheMaps.delete(name); },
    async keys() { return [...cacheMaps.keys()]; },
  };
  const sandbox = {
    URL, caches,
    self: {
      registration: { scope: origin },
      addEventListener(type, handler) { handlers[type] = handler; },
      async skipWaiting() { skipped = true; },
      clients: { async claim() {} },
    },
    async fetch(request) {
      const url = typeof request === 'string' ? request : request.url;
      if (url.endsWith(failPath ?? '\0')) return new Response('missing', { status: 404 });
      return new Response(url === origin ? html : `asset ${url}`);
    },
  };
  vm.runInNewContext(source, sandbox, { filename: 'sw.js' });
  const dispatch = (type, event = {}) => {
    let pending;
    handlers[type]({ ...event, waitUntil(value) { pending = value; }, respondWith(value) { pending = value; } });
    return pending;
  };
  return { dispatch, sandbox, cacheMaps, get skipped() { return skipped; }, get matchOptions() { return matchOptions; } };
}

const failed = worker('/assets/app.js');
await assert.rejects(failed.dispatch('install'), /Could not cache/);
assert.equal(failed.skipped, false, 'a failed install must not activate');
assert.equal(failed.cacheMaps.has(cacheName), false, 'the incomplete cache is removed');
assert.equal(await failed.cacheMaps.get('harbor-master-shell-v4').get(origin).clone().text(), 'old shell', 'the previous offline shell survives');

const ready = worker();
await ready.dispatch('install');
assert.equal(ready.skipped, true);
assert.ok(ready.cacheMaps.get(cacheName).has(`${origin}assets/app.js`));
assert.equal(await ready.cacheMaps.get(cacheName).get(origin).clone().text(), html);
ready.sandbox.fetch = async () => new Response('new network shell');
const request = { method: 'GET', url: origin, mode: 'navigate' };
assert.equal(await (await ready.dispatch('fetch', { request })).text(), 'new network shell');
assert.equal(await ready.cacheMaps.get(cacheName).get(origin).clone().text(), html, 'a network navigation cannot replace the verified offline shell');
ready.sandbox.fetch = async () => { throw new Error('offline'); };
assert.equal(await (await ready.dispatch('fetch', { request })).clone().text(), html, 'offline navigation uses the verified shell');
const assetRequest = { method: 'GET', url: `${origin}assets/app.js`, mode: 'cors' };
assert.ok(await ready.dispatch('fetch', { request: assetRequest }));
assert.equal(ready.matchOptions.ignoreVary, true, 'same-origin shell assets survive Vary: Origin');
await ready.dispatch('activate');
assert.equal(ready.cacheMaps.has('harbor-master-shell-v4'), false, 'the old cache is removed only after activation');
console.log('PASS: atomic service-worker installation, offline fallback and Vary handling');
