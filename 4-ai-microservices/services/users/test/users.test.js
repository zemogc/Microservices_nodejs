const test = require('node:test');
const assert = require('node:assert/strict');
const { listen } = require('../../../test-helpers');
const { createApp } = require('../app');

test('lists users and finds one by id', async (t) => {
  const url = await listen(createApp(), t);

  const users = await (await fetch(`${url}/api/users`)).json();
  assert.ok(users.length >= 4);

  const finn = await (await fetch(`${url}/api/users/2`)).json();
  assert.equal(finn.username, 'finn');
});

test('answers 404 for an unknown user', async (t) => {
  const url = await listen(createApp(), t);
  const res = await fetch(`${url}/api/users/999`);
  assert.equal(res.status, 404);
});

test('exposes a health endpoint', async (t) => {
  const url = await listen(createApp(), t);
  const health = await (await fetch(`${url}/health`)).json();
  assert.equal(health.status, 'ok');
  assert.equal(health.service, 'users');
});
