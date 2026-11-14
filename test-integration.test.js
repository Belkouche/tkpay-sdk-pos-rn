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
 * Runs the compiled client in ./lib through example/quickstart/nodeTransport.js,
 * a Node TCP stand-in for the native module with the same connection semantics.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const HOST = process.env.NAPS_HOST || '127.0.0.1';
const PORT = parseInt(process.env.NAPS_PORT || '4444', 10);
const MODE = process.env.NAPS_EMULATOR_MODE || 'approve';

// Node TCP stand-in for the native module
const { sent, closeSocket } = require('./example/quickstart/nodeTransport');
const { NapsPayClient, parseTlv, receiptToPlainText } = require('./lib');

const client = new NapsPayClient({ host: HOST, port: PORT });

// The native modules keep the Phase-1 socket open until the next request or a
// sendConfirmation; a single-shot reply (e.g. a refused TM 103) leaves it open.
test.afterEach(closeSocket);
const forModes = (...modes) => ({ skip: !modes.includes(MODE) && `emulator mode is ${MODE}` });

/** A whole receipt was parsed, not just its first line. */
function assertFullReceipt(receipt, label) {
  assert.ok(receipt, `${label} present`);
  assert.ok(receipt.lines.length > 5, `${label}: ${receipt.lines.length} line(s) parsed`);
}

/** Golden emulator receipt (spec §5 layout); date, STAN and authorisation vary. */
function assertGoldenReceipt(receipt, amount, label, copy) {
  assert.ok(receipt, `${copy} present`);
  const lines = receiptToPlainText(receipt).split('\n').map((l) => l.trim());
  const expected = [
    'TKpay',
    '--------------------------------',
    /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/,
    'TKPAY DEMO',
    'CASABLANCA',
    '--------------------------------',
    'VISA',
    '516794******3315',
    'Terminal: 00000001',
    /^Transaction: \d{6}$/,
    /^Autorisation: \d{6}$/,
    /^STAN: \d{6}$/,
    '--------------------------------',
    `MONTANT: ${amount} MAD`,
    '--------------------------------',
    label,
    copy,
  ];
  assert.equal(lines.length, expected.length, `${copy}: ${lines.length} lines\n${lines.join('\n')}`);
  expected.forEach((e, i) =>
    typeof e === 'string' ? assert.equal(lines[i], e, `${copy} line ${i + 1}`) : assert.match(lines[i], e, `${copy} line ${i + 1}`));
}

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

test('approve: payment gives both golden copies; the void TM 104 receipt is the merchant copy', forModes('approve'), async () => {
  const payment = await pay(10);
  assertGoldenReceipt(payment.merchantReceipt, '10.00', 'DEBIT', 'Copie Commerçant');
  assertGoldenReceipt(payment.customerReceipt, '10.00', 'DEBIT', 'Copie Client');

  const voided = await client.cancelPayment(payment.stan, '01', '00001', payment.sequence, 1000);
  assert.equal(voided.success, true, voided.error);
  // Live terminals: TM 103 has no receipt; the TM 104 receipt is the merchant copy.
  assertGoldenReceipt(voided.merchantReceipt, '10.00', 'ANNULATION', 'Copie Commerçant');
  assert.equal(voided.customerReceipt, undefined);
});

test('approve: payment, management ops and two-phase void', forModes('approve'), async () => {
  const payment = await pay();
  assert.match(payment.maskedCardNumber, /^\d{6}\*+\d{4}$/);
  assertFullReceipt(payment.merchantReceipt, 'payment merchant receipt');
  assertFullReceipt(payment.customerReceipt, 'payment customer receipt');

  const net = await client.networkTest('01', '00001');
  assert.equal(net.responseCode, 'UNSUPPORTED', 'TM 009 is not sent over TCP');

  const settle = await client.settlement('01', '00001');
  assert.equal(settle.responseCode, 'UNSUPPORTED', 'telecollecte is not part of the ECR protocol');

  for (const op of [
    () => client.totals('01', '00001'),
    () => client.referencing('01', '00001'),
    () => client.printDuplicate('01', '00001'),
    () => client.resetPinPad('01', '00001'),
  ]) {
    const r = await op();
    assert.equal(r.responseCode, '000');
  }

  const { payment: voidedPayment, result, tm003, tm004 } = await payThenVoid();
  assert.equal(result.success, true, result.error);
  assert.equal(result.responseCode, '000');
  assert.equal(result.pendingConfirmation, undefined);
  assert.ok(result.stan);
  assertFullReceipt(result.merchantReceipt, 'void merchant receipt (TM 104)');
  assert.equal(result.customerReceipt, undefined);
  assert.equal(tm004['001'], '004');
  assert.equal(tm003['005'], voidedPayment.sequence, 'TM 003 NSA = payment sequence');
  assert.equal(tm004['004'], tm003['004'], 'TM 004 NS = TM 003 NS');
  assert.equal(tm004['005'], undefined, 'no NSA in TM 004');
  assert.equal(tm004['002'], '1234', 'TM 004 echoes the TM 103 amount');
});

test('decline: refused payment, no Phase 2', forModes('decline'), async () => {
  sent.length = 0;
  const p = await client.processPayment({ amount: 5, registerId: '01', cashierId: '00001' });
  assert.equal(p.success, false);
  assert.notEqual(p.responseCode, '000');
  assertFullReceipt(p.merchantReceipt, 'decline receipt');
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

test('void_995: TM 104 CR=995 is pending, STAN kept', forModes('void_995'), async () => {
  const { result } = await payThenVoid();
  assert.equal(result.success, false);
  assert.equal(result.pendingConfirmation, true);
  assert.equal(result.responseCode, '995');
  assert.ok(result.stan);
  assert.equal(result.merchantReceipt, undefined, 'TM 103 carries no receipt on live terminals');
});

test('void_no_confirm: no TM 104 reply is pending, STAN kept', forModes('void_no_confirm'), async () => {
  const { payment, result } = await payThenVoid();
  assert.equal(result.success, false);
  assert.equal(result.pendingConfirmation, true);
  assert.equal(result.stan, payment.stan, 'STAN from TM 103');
  assert.equal(result.merchantReceipt, undefined, 'TM 103 carries no receipt on live terminals');
});

test('void_refuse: TM 103 refusal is a failure, not pending', forModes('void_refuse'), async () => {
  const { result } = await payThenVoid();
  assert.equal(result.success, false);
  assert.equal(result.pendingConfirmation, undefined);
  assert.notEqual(result.responseCode, '000');
  assert.equal(sent.length, 1, 'no TM 004 after a refused TM 103');
});
