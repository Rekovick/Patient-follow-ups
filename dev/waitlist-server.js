#!/usr/bin/env node
/*
 * Local stand-in for the Department Waiting List setup, for trying it with several "phones":
 *   - runs the real waitlist-server/Code.gs on top of the fake Google services (dev/fake-gas.js)
 *   - serves docs/ the way GitHub Pages does, under /Patient-follow-ups/
 *   - answers POST /exec like the deployed Apps Script web app
 *
 *   node dev/waitlist-server.js [port]     then open http://localhost:<port>/Patient-follow-ups/waitlist/
 *
 * Also used by dev/waitlist-test.js through start().
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

function loadBackend() {
  // fake-gas.js was written for a browser page: give it the few browser globals it touches.
  const memory = {};
  global.window = global;
  global.localStorage = { getItem: k => (k in memory ? memory[k] : null), setItem: (k, v) => { memory[k] = String(v); }, removeItem: k => { delete memory[k]; } };
  global.addEventListener = () => {};
  global.FAKE_LATENCY = 0;
  require('./fake-gas.js');
  const code = fs.readFileSync(path.join(root, 'waitlist-server', 'Code.gs'), 'utf8');
  // Indirect eval runs Code.gs in the global scope, as Apps Script does.
  (0, eval)(code + '\n;global.__waitlist = { doPost, setup, resetTeamKey };');
  const logs = [];
  global.Logger.log = m => logs.push(String(m));
  global.__waitlist.setup();
  const key = PropertiesService.getScriptProperties().getProperty('TEAM_KEY');
  return { api: global.__waitlist, key: key, logs: logs };
}

function start(port) {
  const backend = loadBackend();
  const stats = { posts: 0 };
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.split('?')[0] === '/exec') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        stats.posts++;
        const out = backend.api.doPost({ postData: { contents: body } }).getContent();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(out);
      });
      return;
    }
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (!p.startsWith('/Patient-follow-ups/')) { res.writeHead(404); res.end(); return; }
    p = p.slice('/Patient-follow-ups'.length);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, 'docs', p);
    if (!file.startsWith(path.join(root, 'docs')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(port || 0, () => {
    const url = 'http://localhost:' + server.address().port;
    resolve({ server, url, key: backend.key, backend, stats });
  }));
}

module.exports = { start };

if (require.main === module) {
  start(Number(process.argv[2]) || 8770).then(s => {
    console.log('App:        ' + s.url + '/Patient-follow-ups/waitlist/');
    console.log('Server link: ' + s.url + '/exec');
    console.log('Team key:   ' + s.key);
  });
}
