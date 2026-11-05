import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, type TestServer } from './helpers.ts';

/** Battle WebSocket `/game` handshake with different compression offers: like Chrome, like Safari (no parameters), no extensions */
let s: TestServer;
before(async () => { s = await startServer(); });
after(async () => { await s.stop(); });

function upgrade(ext: string | null): Promise<{ status: number; ext: string }> {
  const u = new URL(s.base);
  return new Promise((ok) => {
    const req = http.request({ host: u.hostname, port: u.port, path: '/game', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...(ext ? { 'Sec-WebSocket-Extensions': ext } : {}) } });
    req.on('upgrade', (res, socket) => { socket.destroy(); ok({ status: 101, ext: String(res.headers['sec-websocket-extensions'] ?? '') }); });
    req.on('response', (res) => { res.resume(); ok({ status: res.statusCode ?? 0, ext: '' }); });
    req.end();
  });
}

test('/game: compression negotiates with Chrome and with Safari (bare permessage-deflate), without extensions — plain connection', async () => {
  const chrome = await upgrade('permessage-deflate; client_max_window_bits');
  assert.equal(chrome.status, 101);
  assert.match(chrome.ext, /permessage-deflate/);
  const safari = await upgrade('permessage-deflate');
  assert.equal(safari.status, 101, 'Safari does not get 400');
  assert.match(safari.ext, /permessage-deflate/);
  const plain = await upgrade(null);
  assert.equal(plain.status, 101);
  assert.equal(plain.ext, '');
});
