const test = require('node:test');
const assert = require('node:assert/strict');
const { listen } = require('../../../test-helpers');
const users = require('../../users/app');
const threads = require('../../threads/app');
const { createApp } = require('../app');

test('routes /api/* to the right service, including POST bodies', async (t) => {
  process.env.USERS_URL = await listen(users.createApp(), t);
  process.env.THREADS_URL = await listen(threads.createApp(), t);
  const url = await listen(createApp(), t);

  const finn = await (await fetch(`${url}/api/users/2`)).json();
  assert.equal(finn.username, 'finn');

  const res = await fetch(`${url}/api/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Desde el gateway', createdBy: 1 }),
  });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).title, 'Desde el gateway');
});

test('reports 502 when a service is unreachable', async (t) => {
  process.env.AI_URL = 'http://localhost:9';
  const url = await listen(createApp(), t);
  assert.equal((await fetch(`${url}/api/ai/status`)).status, 502);
});

test('aggregates the health of every service', async (t) => {
  process.env.USERS_URL = await listen(users.createApp(), t);
  process.env.THREADS_URL = await listen(threads.createApp(), t);
  process.env.POSTS_URL = 'http://localhost:9';
  process.env.AI_URL = 'http://localhost:9';
  const url = await listen(createApp(), t);

  const health = await (await fetch(`${url}/api/health`)).json();
  const status = Object.fromEntries(health.services.map((s) => [s.name, s.status]));
  assert.deepEqual(status, { users: 'up', threads: 'up', posts: 'down', ai: 'down' });
  assert.equal(health.healthy, false);
});

test('serves the web app', async (t) => {
  const url = await listen(createApp(), t);
  const html = await (await fetch(`${url}/`)).text();
  assert.match(html, /Ooo Forum/);
});

test('pushes new posts to browsers listening on /api/events', async (t) => {
  process.env.POSTS_URL = await listen((req, res) => {
    res.statusCode = 201;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 77, thread: 1, user: 2, text: 'En vivo' }));
  }, t);
  const url = await listen(createApp(), t);

  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await fetch(`${url}/api/events`, { signal: controller.signal });
  assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
  const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  await reader.read(); // retry hint

  await fetch(`${url}/api/posts`, { method: 'POST', body: '{}', headers: { 'x-request-id': 'tab-1' } });
  const { value } = await reader.read();
  assert.match(value, /^event: post\n/);
  const event = JSON.parse(value.split('data: ')[1]);
  assert.equal(event.item.id, 77);
  assert.equal(event.requestId, 'tab-1'); // lets the tab that wrote it skip its own event
});
