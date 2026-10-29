const cluster = require('cluster');
const numCPUs = require('os').availableParallelism();

if (cluster.isPrimary) {
  console.log(`Leader ${process.pid} is running`);

  // Fork workers.
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`worker ${worker.process.pid} died (${signal || code}), forking a new one`);
    cluster.fork();
  });
} else {
  const app = require('./server.js');
  app.listen(process.env.PORT || 3000);

  console.log(`Worker ${process.pid} started`);
}
