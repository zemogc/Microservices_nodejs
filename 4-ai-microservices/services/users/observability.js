const { randomUUID } = require('crypto');

// Identical copy in every service, so each Docker image stays self-contained
// (a test checks the copies never drift apart).
//
// Tags each request with an id that travels across services in `x-request-id`,
// logs one JSON line per request and keeps counters for the /health endpoint.
function observability(service, { quiet = (path) => path === '/health' } = {}) {
  const stats = { requests: 0, errors: 0 };

  async function middleware(ctx, next) {
    const start = Date.now();
    ctx.state.requestId = ctx.get('x-request-id') || randomUUID();
    ctx.set('x-request-id', ctx.state.requestId);

    let status;
    try {
      await next();
      status = ctx.status;
    } catch (err) {
      status = err.status || 500;
      throw err;
    } finally {
      if (!quiet(ctx.path)) {
        stats.requests++;
        if (status >= 500) stats.errors++;
        if (process.env.NODE_ENV !== 'test') {
          console.log(
            JSON.stringify({
              ts: new Date().toISOString(),
              service,
              requestId: ctx.state.requestId,
              method: ctx.method,
              path: ctx.url,
              status,
              ms: Date.now() - start,
            })
          );
        }
      }
    }
  }

  // Headers to forward when this request calls another service
  const forward = (ctx) => ({ 'x-request-id': ctx.state.requestId });

  return { middleware, stats, forward };
}

module.exports = { observability };
