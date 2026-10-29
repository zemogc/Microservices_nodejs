const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { listen } = require('../../../test-helpers');
const users = require('../../users/app');
const { createApp } = require('../app');

test('every service ships the same observability.js', () => {
  const services = path.join(__dirname, '..', '..');
  const copies = fs
    .readdirSync(services)
    .map((name) => path.join(services, name, 'observability.js'))
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, 'utf8'));
  assert.equal(copies.length, 5);
  assert.ok(copies.every((c) => c === copies[0]), 'observability.js copies have drifted apart');
});

test('propagates x-request-id from the gateway to the services', async (t) => {
  const seen = [];
  process.env.USERS_URL = await listen((req, res) => {
    seen.push(req.headers['x-request-id']);
    res.setHeader('content-type', 'application/json');
    res.end('[]');
  }, t);
  const url = await listen(createApp(), t);

  const res = await fetch(`${url}/api/users`, { headers: { 'x-request-id': 'trace-123' } });
  assert.equal(res.headers.get('x-request-id'), 'trace-123');
  assert.deepEqual(seen, ['trace-123']);

  // Without an incoming id the gateway creates one
  const generated = (await fetch(`${url}/api/users`)).headers.get('x-request-id');
  assert.match(generated, /^[0-9a-f-]{36}$/);
  assert.equal(seen[1], generated);
});

test('counts requests and errors in /health, ignoring health checks', async (t) => {
  const url = await listen(users.createApp(), t);
  await fetch(`${url}/api/users`);
  await fetch(`${url}/api/users/999`);
  await fetch(`${url}/health`);
  const health = await (await fetch(`${url}/health`)).json();
  assert.equal(health.requests, 2);
  assert.equal(health.errors, 0); // a 404 is a client error, not a service error
});

test('rate limits AI calls per client', async (t) => {
  process.env.AI_RATE_LIMIT = '2';
  t.after(() => delete process.env.AI_RATE_LIMIT);
  process.env.AI_URL = await listen((req, res) => res.end('{}'), t);
  const url = await listen(createApp(), t);
  const call = () => fetch(`${url}/api/ai/ask`, { method: 'POST', body: '{}' });

  assert.equal((await call()).status, 200);
  assert.equal((await call()).status, 200);
  const limited = await call();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);

  // Reads are never limited
  assert.notEqual((await fetch(`${url}/api/ai/status`)).status, 429);
});

test('rejects oversized bodies before proxying them', async (t) => {
  let proxied = false;
  process.env.POSTS_URL = await listen((req, res) => {
    proxied = true;
    res.end('{}');
  }, t);
  const url = await listen(createApp(), t);

  const res = await fetch(`${url}/api/posts`, { method: 'POST', body: 'x'.repeat(200 * 1024) });
  assert.equal(res.status, 413);
  assert.equal(proxied, false);
});

test('sends security headers', async (t) => {
  const url = await listen(createApp(), t);
  const res = await fetch(`${url}/`);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});
