const test = require('node:test');
const assert = require('node:assert/strict');
const { listen } = require('../../../test-helpers');
const { createApp } = require('../app');

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('lists threads newest first', async (t) => {
  const url = await listen(createApp(), t);
  const threads = await (await fetch(`${url}/api/threads`)).json();
  const dates = threads.map((th) => th.createdAt);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test('creates a thread and serves it by id', async (t) => {
  const url = await listen(createApp(), t);

  const res = await post(`${url}/api/threads`, { title: '  Nueva aventura  ', createdBy: 2, tag: 'eventos' });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.title, 'Nueva aventura');

  const fetched = await (await fetch(`${url}/api/threads/${created.id}`)).json();
  assert.deepEqual(fetched, created);
});

test('rejects invalid threads', async (t) => {
  const url = await listen(createApp(), t);
  assert.equal((await post(`${url}/api/threads`, { title: '', createdBy: 1 })).status, 400);
  assert.equal((await post(`${url}/api/threads`, { title: 'Hola', createdBy: 'finn' })).status, 400);
});
