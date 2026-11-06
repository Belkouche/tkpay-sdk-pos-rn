/**
 * Integration tests against the NAPS emulator (tkpay-naps-emulator).
 *
 * Start the emulator in the mode under test, then run with the same mode:
 *
 *   python3 naps_emulator.py --port 4456 --mode void_995
 *   NAPS_PORT=4456 NAPS_EMULATOR_MODE=void_995 npm run test:integration
 *
 * Modes covered: approve, decline, confirm_error (--code 482), void_480,
 * void_995, void_no_confirm, void_refuse (--code 302 or 482).
 *
 * Runs the compiled client in ./lib. The React Native bridge is replaced by a
 * Node TCP transport with the native semantics: Phase 1 opens the connection,
 * Phase 2 reuses it, responses end at '!'/'?' or after 1 s of silence.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const Module = require('module');

const HOST = process.env.NAPS_HOST || '127.0.0.1';
const PORT = parseInt(process.env.NAPS_PORT || '4444', 10);
const MODE = process.env.NAPS_EMULATOR_MODE || 'approve';

let socket = null;
const sent = [];

function readFrame(s, timeout) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let silence = null;
    const done = (value, error) => {
      clearTimeout(timer);
      clearTimeout(silence);
      s.removeAllListeners('data');
      s.removeAllListeners('error');
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => done(null, new Error('Timeout waiting for response')), timeout);
    s.on('data', (chunk) => {
      buf += chunk.toString('latin1');
      clearTimeout(silence);
      const last = buf[buf.length - 1];
      if (last === '!' || last === '?') return done(buf.slice(0, -1));
      silence = setTimeout(() => done(buf), 1000);
    });
    s.on('error', (e) => done(null, e));
  });
}

function closeSocket() {
  if (socket) socket.destroy();
  socket = null;
}

const nodeNative = {
  async sendPaymentRequest(host, port, tlv, timeout) {
    closeSocket();
    socket = net.connect(port, host);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    sent.push(tlv);
    socket.write(tlv);
    try {
      return await readFrame(socket, timeout);
    } catch (e) {
      closeSocket();
      throw e;
    }
  },
  async sendConfirmation(tlv, timeout) {
    if (!socket) throw new Error('No active connection');
    if (tlv) {
      sent.push(tlv);
      socket.write(tlv);
    }
    try {
      return await readFrame(socket, timeout);
    } finally {
      closeSocket();
    }
  },
  async testConnection() {
    return true;
  },
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'react-native') {
    return { NativeModules: { TkpayNaps: nodeNative }, Platform: { OS: 'android' } };
  }
  return originalLoad.call(this, request, ...rest);
};
// Keep gateway notifications off the network
global.fetch = async () => ({ ok: true });

const { NapsPayClient, parseTlv } = require('./lib');

const client = new NapsPayClient({ host: HOST, port: PORT });

// The native modules keep the Phase-1 socket open until the next request or a
// sendConfirmation; a single-shot reply (e.g. a refused TM 103) leaves it open.
test.afterEach(closeSocket);
const forModes = (...modes) => ({ skip: !modes.includes(MODE) && `emulator mode is ${MODE}` });

/** Approved payment to void; returns { stan, sequence }. */
async function pay(amount = 12.34) {
  const p = await client.processPayment({ amount, registerId: '01', cashierId: '00001' });
  assert.equal(p.success, true, `payment: rc=${p.responseCode} ${p.error ?? ''}`);
  return p;
}

async function payThenVoid() {
  const payment = await pay();
  sent.length = 0;
  const result = await client.cancelPayment(payment.stan, '01', '00001', payment.sequence, 1234);
  return { payment, result, tm003: parseTlv(sent[0] ?? ''), tm004: parseTlv(sent[1] ?? '') };
}

test('approve: payment, management ops and two-phase void', forModes('approve'), async () => {
  const payment = await pay();
  assert.match(payment.maskedCardNumber, /^\d{6}\*+\d{4}$/);
  assert.ok(payment.merchantReceipt && payment.customerReceipt);

  for (const op of [
    () => client.networkTest('01', '00001'),
    () => client.totals('01', '00001'),
    () => client.referencing('01', '00001'),
    () => client.printDuplicate('01', '00001'),
    () => client.resetPinPad('01', '00001'),
    () => client.settlement('01', '00001'),
  ]) {
    const r = await op();
    assert.equal(r.responseCode, '000');
  }

  const { result, tm003, tm004 } = await payThenVoid();
  assert.equal(result.success, true, result.error);
  assert.equal(result.responseCode, '000');
  assert.equal(result.pendingConfirmation, undefined);
  assert.ok(result.stan);
  assert.ok(result.merchantReceipt && result.customerReceipt);
  assert.equal(tm004['001'], '004');
  assert.equal(tm004['004'], tm003['005'], 'TM 004 NS = TM 003 sequence');
  assert.equal(tm004['002'], '1234', 'TM 004 echoes the TM 103 amount');
});

test('decline: refused payment, no Phase 2', forModes('decline'), async () => {
  sent.length = 0;
  const p = await client.processPayment({ amount: 5, registerId: '01', cashierId: '00001' });
  assert.equal(p.success, false);
  assert.notEqual(p.responseCode, '000');
  assert.ok(p.merchantReceipt);
  assert.equal(sent.length, 1);
});

test('confirm_error: TM 102 refusal is not an approval', forModes('confirm_error'), async () => {
  const p = await client.processPayment({ amount: 5, registerId: '01', cashierId: '00001' });
  assert.equal(p.success, false);
  assert.notEqual(p.responseCode, '000');
});

test('void_480: TM 104 CR=480 is a completed void', forModes('void_480'), async () => {
  const { result } = await payThenVoid();
  assert.equal(result.success, true, result.error);
  assert.equal(result.responseCode, '480');
  assert.equal(result.pendingConfirmation, undefined);
  assert.ok(result.stan);
});

test('void_995: TM 104 CR=995 is pending, STAN and TM 103 receipt kept', forModes('void_995'), async () => {
  const { result } = await payThenVoid();
  assert.equal(result.success, false);
  assert.equal(result.pendingConfirmation, true);
  assert.equal(result.responseCode, '995');
  assert.ok(result.stan);
  assert.ok(result.merchantReceipt, 'TM 103 merchant receipt');
});

test('void_no_confirm: no TM 104 reply is pending, STAN and TM 103 receipt kept', forModes('void_no_confirm'), async () => {
  const { payment, result } = await payThenVoid();
  assert.equal(result.success, false);
  assert.equal(result.pendingConfirmation, true);
  assert.equal(result.stan, payment.stan, 'STAN from TM 103');
  assert.ok(result.merchantReceipt, 'TM 103 merchant receipt');
});

test('void_refuse: TM 103 refusal is a failure, not pending', forModes('void_refuse'), async () => {
  const { result } = await payThenVoid();
  assert.equal(result.success, false);
  assert.equal(result.pendingConfirmation, undefined);
  assert.notEqual(result.responseCode, '000');
  assert.equal(sent.length, 1, 'no TM 004 after a refused TM 103');
});
