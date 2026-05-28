const path = require('path');
const http = require('http');
const { loadRuntimeConfig } = require('../../../packages/runtime-config');
const { serveStaticFile } = require('../../../packages/shared-utils');

const config = loadRuntimeConfig(path.resolve(__dirname, '../../..'));
const publicDir = path.resolve(__dirname, '../public');

const server = http.createServer((req, res) => {
  const pathname = String(req.url || '/').split('?')[0];
  if (pathname === '/' || pathname === '') {
    serveStaticFile(res, path.join(publicDir, 'index.html'));
    return;
  }
  serveStaticFile(res, path.join(publicDir, pathname.replace(/^\//, '')));
});

server.listen(config.webPort, () => {
  console.log(`[auth-web] listening on http://localhost:${config.webPort}`);
});
