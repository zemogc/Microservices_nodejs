const test = require('node:test');
const assert = require('node:assert/strict');
const { listen } = require('../../../test-helpers');
const { createApp } = require('../app');

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// A fake ai service that answers every moderation request with `verdict`
const fakeAi = (verdict) => (req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(verdict));
};

test('filters posts by thread and by user', async (t) => {
  const url = await listen(createApp(undefined, { aiUrl: null }), t);

  const inThread = await (await fetch(`${url}/api/posts/in-thread/2`)).json();
  assert.ok(inThread.length > 0);
  assert.ok(inThread.every((p) => p.thread === 2));

  const byUser = await (await fetch(`${url}/api/posts/by-user/1`)).json();
  assert.ok(byUser.every((p) => p.user === 1));
});

test('publishes a post approved by the ai service', async (t) => {
  const aiUrl = await listen(fakeAi({ allowed: true, reason: 'ok', mode: 'demo' }), t);
  const url = await listen(createApp(undefined, { aiUrl }), t);

  const res = await post(`${url}/api/posts`, { thread: 1, user: 2, text: '¡Vamos todos!' });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.moderation.mode, 'demo');

  const inThread = await (await fetch(`${url}/api/posts/in-thread/1`)).json();
  assert.ok(inThread.some((p) => p.id === created.id));
});

test('refuses a post the ai service rejects', async (t) => {
  const aiUrl = await listen(fakeAi({ allowed: false, reason: 'insultos', mode: 'claude' }), t);
  const url = await listen(createApp(undefined, { aiUrl }), t);

  const res = await post(`${url}/api/posts`, { thread: 1, user: 2, text: 'texto ofensivo' });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).moderation.reason, 'insultos');
});

test('still publishes when the ai service is down', async (t) => {
  const url = await listen(createApp(undefined, { aiUrl: 'http://localhost:9' }), t);
  const res = await post(`${url}/api/posts`, { thread: 1, user: 2, text: 'Hola' });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).moderation, null);
});

test('validates the payload', async (t) => {
  const url = await listen(createApp(undefined, { aiUrl: null }), t);
  assert.equal((await post(`${url}/api/posts`, { thread: 1, user: 2, text: '   ' })).status, 400);
  assert.equal((await post(`${url}/api/posts`, { thread: '1', user: 2, text: 'hola' })).status, 400);
});
