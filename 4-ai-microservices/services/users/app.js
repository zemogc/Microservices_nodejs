const Koa = require('koa');
const Router = require('@koa/router');
const seed = require('./db.json');

function createApp(data = structuredClone(seed)) {
  const app = new Koa();
  const router = new Router();

  // Log requests
  app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    if (process.env.NODE_ENV !== 'test') {
      console.log('[users] %s %s - %s - %sms', ctx.method, ctx.url, ctx.status, Date.now() - start);
    }
  });

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
    ctx.body = { service: 'users', status: 'ok', uptime: process.uptime(), count: data.users.length };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}

module.exports = { createApp };
