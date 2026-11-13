/**
 * Reply reader framing, through example/quickstart/nodeTransport.js (the Node
 * stand-in for the native module, same rules as TlvFraming.kt / TlvFraming.swift)
 * against a scripted TCP server on 127.0.0.1.
 *
 * Runs against the compiled output in ./lib (built by `npm run build`).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');

const { closeSocket } = require('./example/quickstart/nodeTransport');
const { NativeModules } = require('react-native'); // installed by nodeTransport
const { buildField, NapsPayClient, ErrorCode, NapsError, MAX_RESPONSE_CHARS } = require('./lib');

const native = NativeModules.TkpayNaps;

/** Server that answers the first request with `chunks`, written `gapMs` apart. */
async function server(chunks, gapMs = 150) {
  const sockets = new Set();
  const srv = net.createServer((sock) => {
    sockets.add(sock);
    sock.once('data', async () => {
      for (const c of chunks) {
        if (sock.destroyed) return;
        sock.write(c);
        await new Promise((r) => setTimeout(r, gapMs));
      }
    });
    sock.on('error', () => {});
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const close = () => {
    for (const sock of sockets) sock.destroy();
    return new Promise((r) => srv.close(r));
  };
  return { port: srv.address().port, close };
}

const line = (n, text) =>
  buildField('030', String(n).padStart(2, '0')) + buildField('031', 'S') + buildField('032', 'G') + buildField('033', text);
const head = buildField('001', '110') + buildField('013', '000');

test.afterEach(closeSocket);

test('a chunk ending at a receipt line\'s "?" or a "!" in the text does not end the reply', async () => {
  const dp = line(1, 'TOTAL?') + '*' + line(2, 'MERCI!') + '?';
  const frame = head + buildField('010', dp) + buildField('016', 'FIN') + '!';
  const cut1 = frame.indexOf('TOTAL?') + 6;
  const cut2 = frame.indexOf('MERCI!') + 6;
  const srv = await server([frame.slice(0, cut1), frame.slice(cut1, cut2), frame.slice(cut2)]);
  try {
    const started = Date.now();
    const reply = await native.sendPaymentRequest('127.0.0.1', srv.port, 'REQ', 5000);
    assert.equal(reply, frame.slice(0, -1), 'whole reply, boundary terminator stripped');
    assert.ok(Date.now() - started < 1000, 'ended at the terminator, not the silence fallback');
  } finally {
    await srv.close();
  }
});

test('a DP that is the last field and ends with "?" is kept whole (silence fallback)', async () => {
  const dp = line(1, 'A') + '?';
  const frame = head + buildField('010', dp);
  const srv = await server([frame]);
  try {
    const reply = await native.sendPaymentRequest('127.0.0.1', srv.port, 'REQ', 5000);
    assert.equal(reply, frame, "the DP's own '?' is not stripped");
  } finally {
    await srv.close();
  }
});

test('a reply over 64 KB fails with INVALID_RESPONSE', async () => {
  const big = 'X'.repeat(MAX_RESPONSE_CHARS + 1);
  const srv = await server([big.slice(0, 40000), big.slice(40000)], 50);
  try {
    await assert.rejects(native.sendPaymentRequest('127.0.0.1', srv.port, 'REQ', 5000), (e) => e.code === 'INVALID_RESPONSE');
    const client = new NapsPayClient({ host: '127.0.0.1', port: srv.port });
    await assert.rejects(
      client.processPayment({ amount: 1, registerId: '01', cashierId: '00001' }),
      (e) => e instanceof NapsError && e.code === ErrorCode.INVALID_RESPONSE
    );
  } finally {
    await srv.close();
  }
});
