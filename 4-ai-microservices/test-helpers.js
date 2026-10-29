// Starts a Koa app (or plain http handler) on a random port and returns its base URL
process.env.NODE_ENV = 'test';
const http = require('http');

async function listen(appOrHandler, t) {
  const handler = appOrHandler.callback ? appOrHandler.callback() : appOrHandler;
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://localhost:${server.address().port}`;
}

module.exports = { listen };
