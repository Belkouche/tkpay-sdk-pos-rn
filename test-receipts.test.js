/**
 * Receipt tests (spec §5): every DP line parsed, in order, with bold and
 * alignment, no SDK-added or rewritten lines; merchant and customer copies on
 * payment and void results.
 *
 * Uses raw emulator responses captured in test-fixtures/emulator-receipts.json.
 * Runs against the compiled output in ./lib (built by `npm run build`).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fixture = require('./test-fixtures/emulator-receipts.json');

// Scripted native module: each call pops the next canned response.
let nativeResponses = [];
const fakeNative = {
  sendPaymentRequest: async () => nativeResponses.shift(),
  sendConfirmation: async () => {
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
  parseTlv,
  parseReceipt,
  receiptToPlainText,
  maskCardNumbersInText,
  NapsPayClient,
  ReceiptType,
  Alignment,
} = require('./lib');

/** Plain-text rendering, each line trimmed. */
const rendered = (receipt) => receiptToPlainText(receipt).split('\n').map((l) => l.trim());

/** Golden lines for the fixture (values from the captured frames). */
function golden({ time, auth, stan, label, copy }) {
  return [
    'TKpay',
    '--------------------------------',
    `07/11/2026 ${time}`,
    'TKPAY DEMO',
    'CASABLANCA',
    '--------------------------------',
    'VISA',
    '516794******3315',
    'Terminal: 00000001',
    `Transaction: ${stan}`,
    `Autorisation: ${auth}`,
    `STAN: ${stan}`,
    '--------------------------------',
    'MONTANT: 10.00 MAD',
    '--------------------------------',
    label,
    copy,
  ];
}
const PAY_MERCHANT = golden({ time: '00:11:30', auth: '956272', stan: '522544', label: 'DEBIT', copy: 'Copie Commercant' });
const PAY_CUSTOMER = golden({ time: '00:11:30', auth: '517705', stan: '522544', label: 'DEBIT', copy: 'Copie Client' });
const VOID_MERCHANT = golden({ time: '00:11:30', auth: '564812', stan: '522544', label: 'ANNULATION', copy: 'Copie Commercant' });
const VOID_CUSTOMER = golden({ time: '00:11:31', auth: '816720', stan: '115365', label: 'ANNULATION', copy: 'Copie Client' });

const dpOf = (frame) => parseTlv(frame)['010'];

/** One DP print line: DP1 line number, DP2 format, DP3 alignment, DP4 text. */
const line = (n, fmt, align, text) =>
  buildField('030', n) + buildField('031', fmt) + buildField('032', align) + buildField('033', text);

test('captured TM 101 / 102 DP blocks render the exact golden payment copies', () => {
  assert.deepEqual(rendered(parseReceipt(dpOf(fixture.tm101), ReceiptType.MERCHANT)), PAY_MERCHANT);
  assert.deepEqual(rendered(parseReceipt(dpOf(fixture.tm102), ReceiptType.CUSTOMER)), PAY_CUSTOMER);
});

test('captured TM 103 / 104 DP blocks render the exact golden void copies', () => {
  assert.deepEqual(rendered(parseReceipt(dpOf(fixture.tm103), ReceiptType.MERCHANT)), VOID_MERCHANT);
  assert.deepEqual(rendered(parseReceipt(dpOf(fixture.tm104), ReceiptType.CUSTOMER)), VOID_CUSTOMER);
});

test('each line keeps its DP1 number, DP2 bold and DP3 alignment', () => {
  const receipt = parseReceipt(dpOf(fixture.tm102), ReceiptType.CUSTOMER);
  assert.equal(receipt.type, ReceiptType.CUSTOMER);
  assert.deepEqual(receipt.lines[0], { lineNumber: '00', text: 'TKpay', bold: true, alignment: Alignment.CENTER });
  assert.deepEqual(receipt.lines[1].lineNumber, '02');
  assert.equal(receipt.lines[1].bold, false);
  assert.equal(receipt.lines[1].alignment, Alignment.LEFT);
  assert.deepEqual(
    receipt.lines.map((l) => l.lineNumber),
    ['00', '02', '03', '04', '06', '07', '09', '10', '15', '17', '18', '19', '20', '21', '22', '23', '24'],
  );
});

test('processPayment: merchant copy = TM 101 DP, customer copy = TM 102 DP, nothing added', async () => {
  nativeResponses = [fixture.tm101, fixture.tm102];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  const result = await client.processPayment({ amount: 10, registerId: '01', cashierId: '00001' });

  assert.equal(result.success, true);
  assert.equal(result.merchantReceipt.type, ReceiptType.MERCHANT);
  assert.equal(result.customerReceipt.type, ReceiptType.CUSTOMER);
  assert.deepEqual(rendered(result.merchantReceipt), PAY_MERCHANT);
  assert.deepEqual(rendered(result.customerReceipt), PAY_CUSTOMER);
});

test('cancelPayment: merchant copy = TM 103 DP, customer copy = TM 104 DP', async () => {
  nativeResponses = [fixture.tm103, fixture.tm104];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  const result = await client.cancelPayment('522544', '01', '00001', '000002', 1000);

  assert.equal(result.success, true);
  assert.deepEqual(rendered(result.merchantReceipt), VOID_MERCHANT);
  assert.deepEqual(rendered(result.customerReceipt), VOID_CUSTOMER);
});

test('cancelPayment: a pending void keeps the TM 103 merchant copy', async () => {
  nativeResponses = [fixture.tm103, new Error('Timeout waiting for response')];
  const client = new NapsPayClient({ host: '127.0.0.1' });
  const result = await client.cancelPayment('522544', '01', '00001', '000002', 1000);

  assert.equal(result.pendingConfirmation, true);
  assert.deepEqual(rendered(result.merchantReceipt), VOID_MERCHANT);
  assert.equal(result.customerReceipt, undefined);
});

test('no SDK text: a terminal header mentioning NAPS is kept as sent, nothing inserted', () => {
  const dp = [
    line('01', 'G', 'C', 'CENTRE MONETIQUE NAPS'),
    line('02', 'S', 'G', 'MERCI'),
  ].join('*');
  const receipt = parseReceipt(dp, ReceiptType.CUSTOMER);
  assert.deepEqual(receipt.lines.map((l) => l.text), ['CENTRE MONETIQUE NAPS', 'MERCI']);
});

test('blank lines and lines without text are kept, in order', () => {
  const dp = [
    line('01', 'S', 'G', 'A'),
    line('02', 'S', 'G', ''),
    buildField('030', '03') + buildField('031', 'S') + buildField('032', 'G'),
    line('04', 'S', 'G', 'B'),
  ].join('*') + '?';
  const receipt = parseReceipt(dp, ReceiptType.MERCHANT);
  assert.deepEqual(receipt.lines.map((l) => [l.lineNumber, l.text]), [['01', 'A'], ['02', ''], ['03', ''], ['04', 'B']]);
});

test('a full PAN in DP text is masked (6 + 4) and the line is kept', () => {
  const dp = [
    line('01', 'S', 'G', 'CARTE 5167940123453315'),
    line('02', 'S', 'G', '4000123456789010123'),
  ].join('*');
  const receipt = parseReceipt(dp, ReceiptType.MERCHANT);
  assert.deepEqual(receipt.lines.map((l) => l.text), ['CARTE 516794******3315', '400012*********0123']);
  assert.equal(maskCardNumbersInText('PAN 4111111111111'), 'PAN 411111***1111');
});

test('parseTlv keeps a DP block that ends with "?" or contains "!"', () => {
  const dp = line('01', 'S', 'C', 'MERCI DE VOTRE VISITE !') + '*' + line('02', 'S', 'G', 'A BIENTOT') + '?';
  const frame = buildField('001', '102') + buildField('013', '000') + buildField('010', dp) + buildField('014', '07112026');
  const fields = parseTlv(frame + '!');

  assert.equal(fields['010'], dp);
  assert.equal(fields['014'], '07112026', 'fields after the DP are still read');
  const receipt = parseReceipt(fields['010'], ReceiptType.CUSTOMER);
  assert.deepEqual(receipt.lines.map((l) => l.text), ['MERCI DE VOTRE VISITE !', 'A BIENTOT']);
});
