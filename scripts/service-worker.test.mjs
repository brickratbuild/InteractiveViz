import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const origin = 'https://view.brickrat.com';

function worker({ fetch, storageFails = false } = {}) {
  const handlers = {}, stores = new Map();
  let claims = 0;
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(key) { return stores.delete(key); },
    async open(key) {
      if (storageFails) throw new Error('Cache Storage unavailable');
      if (!stores.has(key)) stores.set(key, new Map());
      const entries = stores.get(key);
      return {
        async match(request) { return entries.get(request.url)?.clone(); },
        async put(request, response) { entries.set(request.url, response.clone()); },
      };
    },
  };
  vm.runInNewContext(source, { caches, fetch, URL, Response,
    self: { registration: { scope: `${origin}/` }, skipWaiting() {},
      clients: { claim() { claims++; } }, addEventListener(name, handler) { handlers[name] = handler; } },
  });
  return {
    caches, stores, get claims() { return claims; },
    async activate() { let pending; handlers.activate({ waitUntil(promise) { pending = promise; } }); await pending; },
    async request(path, options) {
      const pending = []; let response;
      handlers.fetch({ request: new Request(new URL(path, origin), options),
        respondWith(promise) { response = promise; }, waitUntil(promise) { pending.push(promise); } });
      const result = await response;
      await Promise.all(pending);
      return result;
    },
    async seed(path, body, name = 'brickrat-shell-v5') {
      await (await caches.open(name)).put(new Request(new URL(path, origin)), new Response(body));
    },
  };
}

test('online revisits serve fresh HTML/scripts instead of the cached deployment', async () => {
  const w = worker({ fetch: async (_request, options) => {
    assert.equal(options.cache, 'no-cache'); return new Response('new deployment');
  } });
  for (const path of ['/resort2', '/main.js', '/js/models/customerConfig.js']) {
    await w.seed(path, 'old deployment');
    assert.equal(await (await w.request(path)).text(), 'new deployment');
    assert.equal(await (await (await w.caches.open('brickrat-shell-v5')).match(new Request(origin + path))).text(), 'new deployment');
  }
});

test('a cached registry never hides newly added customers or masks network failures', async () => {
  let online = true;
  const w = worker({ fetch: async (_request, options) => {
    assert.equal(options.cache, 'no-store');
    if (!online) throw new TypeError('Failed to fetch');
    return Response.json({ resort2: { modelUrl: 'resort2.glb' } });
  } });
  await w.seed('/customers.json', '{}');
  assert.ok((await (await w.request('/customers.json')).json()).resort2);
  online = false;
  assert.equal((await w.request('/customers.json')).status, 503);
  await w.seed('/private.json', 'old');
  assert.equal((await w.request('/private.json', { cache: 'no-store' })).status, 503);
});

test('offline shell fallback and uncached navigation both return responses', async () => {
  const w = worker({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await w.seed('/mansion3', 'cached shell');
  assert.equal(await (await w.request('/mansion3')).text(), 'cached shell');
  const missing = await w.request('/resort2');
  assert.equal(missing.status, 503);
  assert.match(await missing.text(), /internet connection/);
});

test('storage failures cannot break successful network requests or reject offline requests', async () => {
  let online = true;
  const w = worker({ storageFails: true, fetch: async () => {
    if (!online) throw new TypeError('Failed to fetch');
    return new Response('network success');
  } });
  assert.equal(await (await w.request('/resort2')).text(), 'network success');
  online = false;
  assert.equal((await w.request('/resort2')).status, 503);
});

test('worker upgrades remove legacy app caches and leave unrelated caches alone', async () => {
  const w = worker();
  for (const name of ['brickrat-v1', 'brickrat-model-v1', 'brickrat-shell-v2', 'brickrat-shell-v4', 'brickrat-shell-v5', 'other-app']) {
    await w.seed('/main.js', name, name);
  }
  await w.activate();
  assert.deepEqual([...w.stores.keys()], ['brickrat-shell-v5', 'other-app']);
  assert.equal(w.claims, 1);
});

test('cross-origin models and non-GET requests remain browser-managed', async () => {
  const w = worker({ fetch: () => { throw new Error('must not intercept'); } });
  assert.equal(await w.request('https://example.com/model.glb'), undefined);
  assert.equal(await w.request('/save', { method: 'POST' }), undefined);
});
