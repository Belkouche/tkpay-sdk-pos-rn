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
  buildCancellationRequest,
  buildCancellationConfirmation,
  NapsPayClient,
  TIDE,
  ReceiptType,
  describeResponseCode,
  parseReceipt,
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
  assert.equal(result.pendingConfirmation, undefined);
});

test('cancelPayment: TM003 gets a new NS, the payment sequence goes in NSA; TM004 repeats the TM003 NS, no NSA', async () => {
  reset();
  nativeResponses = [voidResponse(), voidConfirmation()];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  await client.cancelPayment('000042', '01', '00001', '000777', 150);

  const tm003 = byTag(nativeCalls[0].tlv);
  const tm004 = byTag(nativeCalls[1].tlv);
  assert.equal(tm003['005'], '000777', 'TM 003 NSA = sequence of the payment to void');
  assert.match(tm003['004'], /^\d{6}$/);
  assert.notEqual(tm003['004'], '000777', 'TM 003 NS is a new sequence');
  assert.equal(tm004['001'], '004');
  assert.equal(tm004['004'], tm003['004'], '004.NS = 003.NS');
  assert.equal(tm004['005'], undefined, 'no NSA in TM 004');
  assert.equal(tm004['008'], '000042');
});

test('cancelPayment: each void gets its own NS', async () => {
  const client = new NapsPayClient({ host: '127.0.0.1' });
  const sequences = [];
  for (let i = 0; i < 2; i++) {
    reset();
    nativeResponses = [voidResponse(), voidConfirmation()];
    await client.cancelPayment('000042', '01', '00001', '000777', 150);
    sequences.push(byTag(nativeCalls[0].tlv)['004']);
  }
  assert.notEqual(sequences[0], sequences[1]);
});

test('TM003 frame order (spec v2 §4.3): TM, NCAI, NS, DA, HE, DATR, HETR, STAN, MT, NSA', () => {
  const frame = buildCancellationRequest('000042', '0100001', '000005', 150, '000777');
  assert.deepEqual(tags(frame), ['001', '003', '004', '014', '015', '018', '019', '008', '002', '005']);
  const f = byTag(frame);
  assert.equal(f['004'], '000005');
  assert.equal(f['005'], '000777');
  assert.equal(f['002'], '150');
  assert.equal(f['018'], f['014'], 'DATR = current date');
  assert.equal(f['019'], f['015'], 'HETR = current time');
  assert.deepEqual(tags(buildCancellationRequest('000042', '0100001', '000005')),
    ['001', '003', '004', '014', '015', '018', '019', '008'], 'MT and NSA only when given');
});

test('TM004 frame order (spec v2 §4.4): TM, NCAI, NS, STAN, MT, DE, DATR, HETR, DA, HE', () => {
  const frame = buildCancellationConfirmation('000042', '0100001', '000005',
    { amount: '000000000150', datr: '10112026', hetr: '101500' });
  assert.deepEqual(tags(frame), ['001', '003', '004', '008', '002', '012', '018', '019', '014', '015']);
  const f = byTag(frame);
  assert.equal(f['002'], '000000000150', 'MT verbatim');
  assert.equal(f['012'], '504', 'DE defaults to 504');
  assert.equal(f['018'], '10112026');
  assert.equal(f['019'], '101500');
  assert.equal(byTag(buildCancellationConfirmation('000042', '0100001', '000005', { amount: '1', currency: '978' }))['012'], '978');
  assert.deepEqual(tags(buildCancellationConfirmation('000042', '0100001', '000005')),
    ['001', '003', '004', '008', '014', '015'], 'no MT/DE/DATR/HETR when TM 103 had none');
  assert.deepEqual(tags(buildCancellationConfirmation('000042', '0100001', '000005', '000000000150')),
    ['001', '003', '004', '008', '002', '012', '014', '015'], 'a string is the amount (earlier signature)');
});

test('cancelPayment: TM004 echoes MT, DE, DATR and HETR from TM103', async () => {
  reset();
  nativeResponses = [
    voidResponse() + buildField('012', '504') + buildField('018', '09112026') + buildField('019', '183000'),
    voidConfirmation(),
  ];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  await client.cancelPayment('000042', '01', '00001', '000777', 150);
  assert.deepEqual(tags(nativeCalls[1].tlv), ['001', '003', '004', '008', '002', '012', '018', '019', '014', '015']);
  const tm004 = byTag(nativeCalls[1].tlv);
  assert.equal(tm004['002'], '000000000150');
  assert.equal(tm004['018'], '09112026');
  assert.equal(tm004['019'], '183000');
});

test('cancelPayment: TM104 CR=480 is a completed cancellation (spec §4.4)', async () => {
  reset();
  nativeResponses = [voidResponse(), voidConfirmation('480')];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  const result = await client.cancelPayment('000042', '01', '00001', '000001', 150);

  assert.equal(result.success, true);
  assert.equal(result.responseCode, '480');
  assert.equal(result.pendingConfirmation, undefined);
  assert.equal(result.error, undefined);
  assert.equal(result.stan, '000099');
});

test('cancelPayment: TM104 CR=995 is pending/unconfirmed — not success, not a hard failure', async () => {
  reset();
  nativeResponses = [voidResponse(), voidConfirmation('995')];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  const result = await client.cancelPayment('000042', '01', '00001', '000001', 150);

  assert.equal(result.success, false);
  assert.equal(result.pendingConfirmation, true);
  assert.equal(result.responseCode, '995');
  assert.equal(result.stan, '000099');
  assert.ok(result.merchantReceipt.lines.some((l) => l.text === 'ANNULATION Commercant'));
  assert.match(result.error, /verify by STAN/);
});

test('cancelPayment: direct MT=104 reply to TM003 uses the same CR rules', async () => {
  const client = new NapsPayClient({ host: '127.0.0.1' });
  for (const [cr, success, pending] of [['480', true, undefined], ['000', true, undefined], ['995', false, true], ['482', false, undefined]]) {
    reset();
    nativeResponses = [voidConfirmation(cr)];
    const result = await client.cancelPayment('000042', '01', '00001', '000001', 150);
    assert.equal(result.success, success, `CR=${cr}`);
    assert.equal(result.pendingConfirmation, pending, `CR=${cr}`);
    assert.equal(nativeCalls.length, 1, 'no TM 004 after a direct MT=104');
  }
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
  assert.equal(refused.pendingConfirmation, undefined, 'a refusal is a hard failure, not pending');

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

test('parseReceipt reads every line of a spec §5 DP block (groups separated by "*", last ends "?")', () => {
  const line = (n, fmt, align, text) =>
    buildField('030', n) + buildField('031', fmt) + buildField('032', align) + buildField('033', text);
  const dpValue =
    line('01', 'S', 'G', 'CENTRE MONETIQUE INTERBANCAIRE ') + '*' +
    line('02', 'S', 'G', '09/05/11 08:12:55 ') + '*' +
    line('03', 'G', 'C', 'Montant: 25040.00 MAD ') + '*' +
    line('04', 'S', 'G', 'CARTE 516794******3315') + '*' +
    line('05', 'S', 'G', 'TICKET A CONSERVER') + '?';
  const receipt = parseReceipt(dpValue, ReceiptType.CUSTOMER);

  assert.deepEqual(receipt.lines.map((l) => l.lineNumber), ['01', '02', '03', '04', '05']);
  assert.equal(receipt.lines[3].text, 'CARTE 516794******3315', '"*" inside a value is kept');
  assert.equal(receipt.lines[2].bold, true);
  assert.equal(receipt.lines[2].alignment, 'CENTER');
  assert.equal(receipt.lines[4].text, 'TICKET A CONSERVER');
});
