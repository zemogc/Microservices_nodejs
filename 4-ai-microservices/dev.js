// Runs the five services locally without Docker: `npm run dev` from the repo root.
const { spawn } = require('child_process');
const path = require('path');

const SERVICES = [
  ['users', 3001, '\x1b[35m'],
  ['threads', 3002, '\x1b[34m'],
  ['posts', 3003, '\x1b[33m'],
  ['ai', 3004, '\x1b[36m'],
  ['gateway', 8080, '\x1b[32m'],
];

const env = {
  ...process.env,
  USERS_URL: 'http://localhost:3001',
  THREADS_URL: 'http://localhost:3002',
  POSTS_URL: 'http://localhost:3003',
  AI_URL: 'http://localhost:3004',
};

const children = SERVICES.map(([name, port, color]) => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, 'services', name),
    env: { ...env, PORT: String(port) },
  });
  const prefix = `${color}${name.padEnd(8)}\x1b[0m|`;
  const pipe = (stream, out) =>
    stream.on('data', (chunk) => chunk.toString().trimEnd().split('\n').forEach((l) => out.write(`${prefix} ${l}\n`)));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
});

console.log('\n  Ooo Forum -> http://localhost:8080\n');

const stop = () => {
  children.forEach((c) => c.kill());
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
