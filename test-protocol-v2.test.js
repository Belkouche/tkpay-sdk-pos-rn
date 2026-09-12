/**
 * Unit tests for the NAPS TLV v2 protocol changes.
 *
 * Runs against the compiled output in ./lib (built by `npm run build`).
 * Uses Node's built-in test runner: `node --test`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildConfirmationRequest,
  parseTlv,
  describeResponseCode,
  isApproved,
  APPROVED_CODES,
} = require('./lib/TlvProtocol');

/** Decode a TLV string into an ordered list of {tag, value} entries. */
function decode(tlv) {
  const out = [];
  let i = 0;
  while (i + 6 <= tlv.length) {
    const tag = tlv.slice(i, i + 3);
    const len = parseInt(tlv.slice(i + 3, i + 6), 10);
    const value = tlv.slice(i + 6, i + 6 + len);
    out.push({ tag, value });
    i += 6 + len;
  }
  return out;
}

test('buildConfirmationRequest v1 form omits MT/DE/NCAR/DAEX', () => {
  const tlv = buildConfirmationRequest('123456', '0100001', '000001');
  const tags = decode(tlv).map((f) => f.tag);
  // TM, NCAI, NS, STAN, DA, HE — no 002/012/007/017
  assert.ok(!tags.includes('002'), 'no MT');
  assert.ok(!tags.includes('012'), 'no DE');
  assert.ok(!tags.includes('007'), 'no NCAR');
  assert.ok(!tags.includes('017'), 'no DAEX');
  assert.ok(tags.includes('008'), 'has STAN');
});

test('buildConfirmationRequest v2 carries MT/DE/NCAR/DAEX in §4.2 order', () => {
  const tlv = buildConfirmationRequest('123456', '0100001', '000001', {
    amountCentimes: 10050,
    ncar: '516794******3315',
    daex: '2812',
  });
  const fields = decode(tlv);
  const tags = fields.map((f) => f.tag);

  // Reference field order: TM(001), NCAI(003), NS(004), MT(002), DE(012),
  // STAN(008), NCAR(007), DAEX(017), DA(014), HE(015).
  assert.deepEqual(tags, ['001', '003', '004', '002', '012', '008', '007', '017', '014', '015']);

  const byTag = Object.fromEntries(fields.map((f) => [f.tag, f.value]));
  assert.equal(byTag['002'], '10050');
  assert.equal(byTag['012'], '504');
  assert.equal(byTag['007'], '516794******3315');
  assert.equal(byTag['017'], '2812');
});

test('buildConfirmationRequest honours a custom currency', () => {
  const tlv = buildConfirmationRequest('123456', '0100001', '000001', {
    amountCentimes: 500,
    currency: '840',
  });
  const byTag = Object.fromEntries(decode(tlv).map((f) => [f.tag, f.value]));
  assert.equal(byTag['012'], '840');
});

test('buildConfirmationRequest omits NCAR/DAEX when only amount provided', () => {
  const tlv = buildConfirmationRequest('123456', '0100001', '000001', {
    amountCentimes: 500,
  });
  const tags = decode(tlv).map((f) => f.tag);
  assert.ok(tags.includes('002'), 'has MT');
  assert.ok(tags.includes('012'), 'has DE');
  assert.ok(!tags.includes('007'), 'no NCAR');
  assert.ok(!tags.includes('017'), 'no DAEX');
});

test('parseTlv stops at the v2 terminator "!"', () => {
  const fields = parseTlv('001003101013003000!GARBAGE_AFTER');
  assert.equal(fields['001'], '101');
  assert.equal(fields['013'], '000');
  assert.equal(Object.keys(fields).length, 2);
});

test('parseTlv stops at the v1 terminator "?"', () => {
  const fields = parseTlv('001003101013003000?trailing');
  assert.equal(fields['001'], '101');
  assert.equal(fields['013'], '000');
  assert.equal(Object.keys(fields).length, 2);
});

test('parseTlv still works without a terminator', () => {
  const fields = parseTlv('001003101013003000');
  assert.equal(fields['001'], '101');
  assert.equal(fields['013'], '000');
});

test('describeResponseCode maps known codes', () => {
  assert.equal(describeResponseCode('000'), 'Approved');
  assert.equal(describeResponseCode('116'), 'Insufficient funds');
  assert.equal(describeResponseCode('101'), 'Card expired');
  assert.equal(describeResponseCode('480'), 'Reversal accepted');
  assert.equal(describeResponseCode('995'), 'Server processing error');
});

test('describeResponseCode falls back for unknown / missing codes', () => {
  assert.equal(describeResponseCode('zzz'), 'Unknown response code: zzz');
  assert.equal(describeResponseCode(undefined), 'Unknown response code: (none)');
});

test('isApproved / APPROVED_CODES cover 000/001/003/007 only', () => {
  assert.deepEqual([...APPROVED_CODES].sort(), ['000', '001', '003', '007']);
  for (const c of ['000', '001', '003', '007']) assert.ok(isApproved(c), `${c} approved`);
  for (const c of ['100', '116', '480', undefined]) assert.ok(!isApproved(c), `${c} not approved`);
});
