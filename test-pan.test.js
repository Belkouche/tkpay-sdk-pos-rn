/**
 * Card number (PAN) handling: masked (first 6 + last 4) as soon as a reply is
 * parsed, never present in results, receipts, errors, request frames, gateway
 * notifications or log output.
 *
 * Runs against the compiled output in ./lib (built by `npm run build`).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// Capture every console call and the gateway notification body.
const logs = [];
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  console[level] = (...args) => logs.push(args.map(String).join(' '));
}
global.__DEV__ = true; // enable the SDK's dev-only logging so it is checked too
const notifications = [];
global.fetch = async (url, init) => {
  notifications.push(String(init && init.body));
  return { ok: true, status: 200 };
};

// Scripted native module: records request frames, pops canned replies.
const requests = [];
let replies = [];
const fakeNative = {
  sendPaymentRequest: async (host, port, tlv) => {
    requests.push(tlv);
    return replies.shift();
  },
  sendConfirmation: async (tlv) => {
    requests.push(tlv);
    return replies.shift();
  },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'react-native') {
    return { NativeModules: { TkpayNaps: fakeNative }, Platform: { OS: 'android' } };
  }
  return originalLoad.call(this, request, ...rest);
};

const { buildField, parseTlv, parseReceipt, maskCardNumber, maskCardNumbersInText, NapsPayClient, ReceiptType } =
  require('./lib');

const PAN = '5167940000123315';
const PAN_SPACED = '5167 9400 0012 3315';
const PAN_19 = '4000123456789010123';
/** Every unmasked form that must never appear. */
const FORBIDDEN = [PAN, PAN_SPACED, '5167-9400-0012-3315', PAN_19, '940000', '45678901'];

function assertNoPan(value, where) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const f of FORBIDDEN) assert.ok(!text.includes(f), `${where} contains "${f}": ${text}`);
}

const line = (n, text) =>
  buildField('030', n) + buildField('031', 'S') + buildField('032', 'G') + buildField('033', text);
const dp = (...texts) => texts.map((t, i) => line(String(i + 1).padStart(2, '0'), t)).join('*');

/** Receipt with a full PAN, a spaced PAN and a 19-digit number in its lines. */
const DP_WITH_PANS = dp('VISA', `CARTE ${PAN_SPACED}`, `REF ${PAN_19}`, `NO ${PAN} FIN`, 'MONTANT: 10.00 MAD');
const MASKED_LINES = ['VISA', 'CARTE 5167 94** **** 3315', 'REF 400012*********0123', 'NO 516794******3315 FIN', 'MONTANT: 10.00 MAD'];

const tm101 = (cr = '000') =>
  buildField('001', '101') + buildField('013', cr) + buildField('008', '000042') +
  buildField('007', PAN) + buildField('017', '3010') + buildField('010', DP_WITH_PANS);
const tm102 = () =>
  buildField('001', '102') + buildField('013', '000') + buildField('008', '000042') +
  buildField('007', PAN) + buildField('010', DP_WITH_PANS);

const flush = () => new Promise((resolve) => setTimeout(resolve, 20)); // let the notification run

function reset() {
  logs.length = 0;
  notifications.length = 0;
  requests.length = 0;
  replies = [];
}

test('masking keeps 6 + 4 digits and the formatting, for 13-19 digits with spaces or dashes', () => {
  assert.equal(maskCardNumber(PAN), '516794******3315');
  assert.equal(maskCardNumber(PAN_SPACED), '5167 94** **** 3315');
  assert.equal(maskCardNumber('516794******3315'), '516794******3315', 'already masked stays as is');
  assert.equal(maskCardNumbersInText(`A ${PAN_SPACED} B`), 'A 5167 94** **** 3315 B');
  assert.equal(maskCardNumbersInText('A 5167-9400-0012-3315 B'), 'A 5167-94**-****-3315 B');
  assert.equal(maskCardNumbersInText('AMEX 3782 822463 10005'), 'AMEX 3782 82**** *0005');
  assert.equal(maskCardNumbersInText(`R ${PAN_19}`), 'R 400012*********0123');
  // Not card numbers: left untouched
  for (const s of ['07/11/2026 00:11:30', 'Terminal: 00000001', 'MONTANT: 10.00 MAD', 'Tel 0522 12 34 56']) {
    assert.equal(maskCardNumbersInText(s), s);
  }
});

test('parseTlv masks NCAR (tag 007), including a spaced value', () => {
  assert.equal(parseTlv(buildField('007', PAN))['007'], '516794******3315');
  assert.equal(parseTlv(buildField('007', PAN_SPACED))['007'], '5167 94** **** 3315');
});

test('receipt lines: PANs masked, every line kept, content otherwise unchanged', () => {
  const receipt = parseReceipt(DP_WITH_PANS, ReceiptType.MERCHANT);
  assert.deepEqual(receipt.lines.map((l) => l.text), MASKED_LINES);
});

test('approved payment: no full PAN in result, receipts, TM 002 frame, notification or logs', async () => {
  reset();
  replies = [tm101(), tm102()];
  const result = await new NapsPayClient({ host: '127.0.0.1' }).processPayment({ amount: 10, registerId: '01', cashierId: '00001' });
  await flush();

  assert.equal(result.success, true);
  assert.equal(result.maskedCardNumber, '516794******3315');
  assert.deepEqual(result.merchantReceipt.lines.map((l) => l.text), MASKED_LINES);
  assert.deepEqual(result.customerReceipt.lines.map((l) => l.text), MASKED_LINES);
  assert.equal(parseTlv(requests[1])['007'], '516794******3315', 'TM 002 echoes the masked NCAR');
  assert.equal(notifications.length, 1);
  assert.ok(logs.length > 0, 'dev logging ran and was captured');

  assertNoPan(result, 'PaymentResult');
  assertNoPan(requests[1], 'TM 002 request frame');
  assertNoPan(notifications, 'gateway notification');
  assertNoPan(logs, 'console output');
});

test('declined payment and protocol errors: no full PAN in result, error text or logs', async () => {
  reset();
  replies = [tm101('116')];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  const declined = await client.processPayment({ amount: 10, registerId: '01', cashierId: '00001' });
  await flush();
  assert.equal(declined.success, false);
  assertNoPan(declined, 'declined PaymentResult');

  // Reply without CR: processPayment throws — the error must not carry the frame
  replies = [buildField('001', '101') + buildField('007', PAN) + buildField('010', DP_WITH_PANS)];
  const error = await client.processPayment({ amount: 10, registerId: '01', cashierId: '00001' }).catch((e) => e);
  assert.ok(error instanceof Error);
  assertNoPan(`${error.message} ${error.stack}`, 'thrown error');

  assertNoPan(notifications, 'gateway notification');
  assertNoPan(logs, 'console output');
});

test('void, duplicate and totals receipts: PANs masked', async () => {
  reset();
  const client = new NapsPayClient({ host: '127.0.0.1' });
  replies = [
    buildField('001', '103') + buildField('013', '000') + buildField('002', '000000001000') +
      buildField('008', '000042') + buildField('007', PAN) + buildField('010', DP_WITH_PANS),
    buildField('001', '104') + buildField('013', '000') + buildField('008', '000099') + buildField('010', DP_WITH_PANS),
  ];
  const voided = await client.cancelPayment('000042', '01', '00001', '000001', 1000);
  assert.deepEqual(voided.merchantReceipt.lines.map((l) => l.text), MASKED_LINES);
  assert.deepEqual(voided.customerReceipt.lines.map((l) => l.text), MASKED_LINES);

  replies = [buildField('001', '108') + buildField('013', '000') + buildField('007', PAN) + buildField('010', DP_WITH_PANS)];
  const dup = await client.printDuplicate('01', '00001', '000042');
  replies = [buildField('001', '110') + buildField('013', '000') + buildField('010', DP_WITH_PANS)];
  const totals = await client.totals('01', '00001');

  assertNoPan([voided, dup, totals], 'results');
  assertNoPan(requests, 'request frames');
  assertNoPan(logs, 'console output');
});
