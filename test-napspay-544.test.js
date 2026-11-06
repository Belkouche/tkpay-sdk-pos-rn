/**
 * Unit tests for the NapsPay v5.4.4 sync with the canonical C# SDK.
 *
 * Runs against the compiled output in ./lib (built by `npm run build`).
 * The React Native bridge is replaced by a scripted fake so the client
 * logic can be exercised under plain Node.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// Scripted native module: each call pops the next canned response.
const nativeCalls = [];
let nativeResponses = [];
const fakeNative = {
  sendPaymentRequest: async (host, port, tlv, timeout) => {
    nativeCalls.push({ fn: 'sendPaymentRequest', tlv, timeout });
    return nativeResponses.shift();
  },
  sendConfirmation: async (tlv, timeout) => {
    nativeCalls.push({ fn: 'sendConfirmation', tlv, timeout });
    const response = nativeResponses.shift();
    if (response instanceof Error) throw response;
    return response;
  },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'react-native') {
    return { NativeModules: { TkpayNaps: fakeNative }, Platform: { OS: 'android' } };
  }
  return originalLoad.call(this, request, ...rest);
};

const {
  buildField,
  buildPaymentRequest,
  buildNetworkTestRequest,
  buildDuplicateRequest,
  buildResetRequest,
  buildReferencingRequest,
  buildTotalsRequest,
  buildSettlementRequest,
  NapsPayClient,
  TIDE,
  ReceiptType,
  describeResponseCode,
} = require('./lib');

/** Decode a TLV string into an ordered list of {tag, value} entries. */
function decode(tlv) {
  const out = [];
  let i = 0;
  while (i + 6 <= tlv.length) {
    const tag = tlv.slice(i, i + 3);
    const len = parseInt(tlv.slice(i + 3, i + 6), 10);
    out.push({ tag, value: tlv.slice(i + 6, i + 6 + len) });
    i += 6 + len;
  }
  return out;
}
const tags = (tlv) => decode(tlv).map((f) => f.tag);
const byTag = (tlv) => Object.fromEntries(decode(tlv).map((f) => [f.tag, f.value]));

/** Receipt DP with one centred line. */
function dp(text) {
  return buildField('030', '01') + buildField('031', 'S') + buildField('032', 'C') + buildField('033', text);
}

function reset() {
  nativeCalls.length = 0;
  nativeResponses = [];
}

test('buildField is exported and encodes TAG(3) LEN(3) VALUE', () => {
  assert.equal(buildField('001', '009'), '001003009');
});

test('payment request carries DA/HE and DATR/HETR (TM, MT, NCAI, NS, DE, DA, HE, DATR, HETR)', () => {
  const tlv = buildPaymentRequest(1.5, '0100001', '000007');
  assert.deepEqual(tags(tlv), ['001', '002', '003', '004', '012', '014', '015', '018', '019']);
  const f = byTag(tlv);
  assert.equal(f['002'], '150');
  assert.equal(f['018'], f['014']);
  assert.equal(f['019'], f['015']);
});

test('management requests carry NS after NCAI', () => {
  assert.deepEqual(tags(buildNetworkTestRequest('0100001', '000003')), ['001', '003', '004', '014', '015']);
  assert.deepEqual(tags(buildResetRequest('0100001', '000003')), ['001', '003', '004', '014', '015']);
  assert.deepEqual(tags(buildTotalsRequest('0100001', '000003')), ['001', '003', '004', '014', '015']);
  assert.equal(byTag(buildTotalsRequest('0100001', '000003'))['001'], '010');
  assert.equal(byTag(buildNetworkTestRequest('0100001', '000003'))['004'], '000003');
});

test('duplicate request carries NS and keeps the optional STAN', () => {
  assert.deepEqual(tags(buildDuplicateRequest('0100001')), ['001', '003', '004', '014', '015']);
  const withStan = buildDuplicateRequest('0100001', '123456', '000003');
  assert.deepEqual(tags(withStan), ['001', '003', '004', '008', '014', '015']);
  assert.equal(byTag(withStan)['008'], '123456');
  assert.equal(byTag(withStan)['004'], '000003');
});

test('referencing request carries NS and TIDE (default 01 merchant)', () => {
  const tlv = buildReferencingRequest('0100001', '000003');
  assert.deepEqual(tags(tlv), ['001', '003', '004', '014', '015', '020']);
  assert.equal(byTag(tlv)['020'], TIDE.MERCHANT);
  assert.equal(byTag(buildReferencingRequest('0100001', '000003', TIDE.RECHARGE))['020'], '02');
});

test('settlement request is unchanged (TM, NCAI, DA, HE)', () => {
  assert.deepEqual(tags(buildSettlementRequest('0100001')), ['001', '003', '014', '015']);
});

test('processPayment: merchant receipt from Phase-1 DP, customer receipt from Phase-2 DP', async () => {
  reset();
  nativeResponses = [
    buildField('001', '101') + buildField('013', '000') + buildField('008', '000042') +
      buildField('007', '516794******3315') + buildField('017', '3010') + buildField('010', dp('Copie Commercant')),
    buildField('001', '102') + buildField('013', '000') + buildField('008', '000042') +
      buildField('004', '000001') + buildField('010', dp('Copie Client')),
  ];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  const result = await client.processPayment({ amount: 1, registerId: '01', cashierId: '00001' });

  assert.equal(result.success, true);
  assert.equal(result.merchantReceipt.type, ReceiptType.MERCHANT);
  assert.ok(result.merchantReceipt.lines.some((l) => l.text === 'Copie Commercant'));
  assert.ok(!result.merchantReceipt.lines.some((l) => l.text === 'Copie Client'));
  assert.ok(result.customerReceipt.lines.some((l) => l.text === 'Copie Client'));
  assert.equal(nativeCalls[1].timeout, 40000, 'Phase-2 uses the 40 s confirmation timeout');
});

test('processPayment: declined result carries masked PAN and decline receipt', async () => {
  reset();
  nativeResponses = [
    buildField('001', '101') + buildField('013', '116') + buildField('008', '000043') +
      buildField('007', '5167940123453315') + buildField('010', dp('REFUSEE')),
  ];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  const result = await client.processPayment({ amount: 1, registerId: '01', cashierId: '00001' });

  assert.equal(result.success, false);
  assert.equal(result.responseCode, '116');
  assert.equal(result.maskedCardNumber, '516794******3315');
  assert.ok(result.merchantReceipt.lines.some((l) => l.text === 'REFUSEE'));
  assert.equal(nativeCalls.length, 1, 'no Phase-2 after a decline');
});

test('totals() sends TM=010 with NS and returns the receipt', async () => {
  reset();
  nativeResponses = [buildField('001', '110') + buildField('013', '000') + buildField('010', dp('TOTAUX'))];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  const result = await client.totals('01', '00001');

  assert.equal(result.success, true);
  assert.ok(result.receipt.lines.some((l) => l.text === 'TOTAUX'));
  assert.deepEqual(tags(nativeCalls[0].tlv), ['001', '003', '004', '014', '015']);
});

test('referencing() sends the requested TIDE and reports the parameter set', async () => {
  reset();
  nativeResponses = [buildField('001', '113') + buildField('013', '000') + buildField('020', '02')];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  const result = await client.referencing('01', '00001', TIDE.RECHARGE);

  assert.equal(result.success, true);
  assert.equal(result.parameterSet, '02');
  assert.equal(byTag(nativeCalls[0].tlv)['020'], '02');
});

test('processPayment: TM102 refusal (CR != 000) is not an approval', async () => {
  reset();
  nativeResponses = [
    buildField('001', '101') + buildField('013', '000') + buildField('008', '000044') +
      buildField('007', '516794******3315') + buildField('010', dp('Copie Commercant')),
    buildField('001', '102') + buildField('013', '482') + buildField('008', '000044') +
      buildField('010', dp('ANNULEE')),
  ];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  const result = await client.processPayment({ amount: 1, registerId: '01', cashierId: '00001' });

  assert.equal(result.success, false);
  assert.equal(result.responseCode, '482');
  assert.equal(result.error, 'Transaction already cancelled');
  assert.ok(result.merchantReceipt.lines.some((l) => l.text === 'ANNULEE'));
});

/** TM 103 (void performed) and TM 104 (void confirmation) replies. */
const voidResponse = (cr = '000') =>
  buildField('001', '103') + buildField('013', cr) + buildField('002', '000000000150') +
  buildField('008', '000042') + buildField('010', dp('ANNULATION Commercant'));
const voidConfirmation = (cr = '000') =>
  buildField('001', '104') + buildField('013', cr) + buildField('008', '000099') +
  buildField('010', dp('ANNULATION Client'));

test('cancelPayment: TM003→103 then TM004→104 returns void STAN and both void receipts', async () => {
  reset();
  nativeResponses = [voidResponse(), voidConfirmation()];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  const result = await client.cancelPayment('000042', '01', '00001', '000001', 150);

  assert.equal(result.success, true);
  assert.equal(result.responseCode, '000');
  assert.equal(result.stan, '000099', 'void STAN from TM 104');
  assert.ok(result.merchantReceipt.lines.some((l) => l.text === 'ANNULATION Commercant'));
  assert.ok(result.customerReceipt.lines.some((l) => l.text === 'ANNULATION Client'));
  assert.equal(byTag(nativeCalls[0].tlv)['001'], '003');
  assert.equal(byTag(nativeCalls[1].tlv)['001'], '004');
  assert.equal(byTag(nativeCalls[1].tlv)['002'], '000000000150', 'TM 004 echoes the TM 103 amount');
});

test('cancelPayment: missing TM104 reply (timeout) fails closed with pendingConfirmation', async () => {
  reset();
  nativeResponses = [voidResponse(), new Error('Timeout waiting for response')];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  const result = await client.cancelPayment('000042', '01', '00001', '000001', 150);

  assert.equal(result.success, false);
  assert.equal(result.pendingConfirmation, true);
  assert.equal(result.responseCode, '000');
  assert.equal(result.stan, '000042');
  assert.ok(result.merchantReceipt.lines.some((l) => l.text === 'ANNULATION Commercant'));
  assert.equal(result.customerReceipt, undefined);
});

test('cancelPayment: TM104 refusal fails the void; connection errors still fail', async () => {
  reset();
  nativeResponses = [voidResponse(), voidConfirmation('302')];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  const refused = await client.cancelPayment('000042', '01', '00001', '000001', 150);
  assert.equal(refused.success, false);
  assert.equal(refused.responseCode, '302');

  reset();
  nativeResponses = [voidResponse(), new Error('No active connection')];
  const dropped = await client.cancelPayment('000042', '01', '00001', '000001', 150);
  assert.equal(dropped.success, false);
});

test('response-code table covers the full NapsPay ISO list', () => {
  for (const code of ['265', '281', '385', '400', '500', '888']) {
    assert.ok(!describeResponseCode(code).startsWith('Unknown'), code);
  }
  assert.equal(describeResponseCode('481'), 'Reversal amount incorrect');
  assert.equal(describeResponseCode('581'), 'Reconciliation already done');
});
