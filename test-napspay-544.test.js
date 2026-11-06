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
    return nativeResponses.shift();
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
