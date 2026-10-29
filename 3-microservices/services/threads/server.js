const Koa = require('koa');
const Router = require('@koa/router');
const db = require('./db.json');

const app = new Koa();
const router = new Router();
const PORT = process.env.PORT || 3000;

// Log requests
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  console.log('%s %s - %s - %sms', ctx.method, ctx.url, ctx.status, Date.now() - start);
});

// Respond 404 when a lookup finds nothing
const found = (ctx, item, what) => {
  if (item) {
    ctx.body = item;
  } else {
    ctx.status = 404;
    ctx.body = { error: `${what} not found` };
  }
};

router.get('/api/threads', (ctx) => {
  ctx.body = db.threads;
});

router.get('/api/threads/:threadId', (ctx) => {
  const id = parseInt(ctx.params.threadId);
  found(ctx, db.threads.find((thread) => thread.id === id), 'Thread');
});

router.get('/api/', (ctx) => {
  ctx.body = 'API ready to receive requests';
});

router.get('/', (ctx) => {
  ctx.body = 'Ready to receive requests';
});

app.use(router.routes());
app.use(router.allowedMethods());

module.exports = app;

if (require.main === module) {
  const server = app.listen(PORT, () => console.log(`Worker ${process.pid} listening on ${PORT}`));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
