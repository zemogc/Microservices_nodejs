const Koa = require('koa');
const Router = require('@koa/router');
const seed = require('./db.json');
const { observability } = require('./observability');

function createApp(data = structuredClone(seed)) {
  const app = new Koa();
  const router = new Router();

  const obs = observability('users');
  app.use(obs.middleware);

  router.get('/api/users', (ctx) => {
    ctx.body = data.users;
  });

  router.get('/api/users/:userId', (ctx) => {
    const id = parseInt(ctx.params.userId);
    const user = data.users.find((u) => u.id === id);
    if (!user) ctx.throw(404, 'User not found');
    ctx.body = user;
  });

  router.get('/health', (ctx) => {
    ctx.body = { service: 'users', status: 'ok', uptime: process.uptime(), ...obs.stats, count: data.users.length };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}

module.exports = { createApp };
