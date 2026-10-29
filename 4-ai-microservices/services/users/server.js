const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const server = createApp().listen(PORT, () => console.log('[users] listening on ' + PORT));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
