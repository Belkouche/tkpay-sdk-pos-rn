/**
 * TLV framing: fields walked by their 3-digit lengths (fieldEnd), shared by the
 * parser (parseTlv) and the reader check (isCompleteMessage).
 *
 * Runs against the compiled output in ./lib (built by `npm run build`).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildField, fieldEnd, isCompleteMessage, parseTlv, parseReceipt, ReceiptType } = require('./lib');

/** One receipt line: DP1 number, DP2 format, DP3 alignment, DP4 text. */
const line = (n, text) =>
  buildField('030', String(n).padStart(2, '0')) + buildField('031', 'S') + buildField('032', 'G') + buildField('033', text);

/** A DP block: lines separated by '*', ending with '?' (spec §5). */
const dpBlock = (...texts) => texts.map((t, i) => line(i + 1, t)).join('*') + '?';

const head = buildField('001', '101') + buildField('013', '000') + buildField('008', '000042');

test('a "!" inside a receipt line is data, not the end of the reply', () => {
  const dp = dpBlock('MERCI!', 'A BIENTOT');
  const frame = head + buildField('010', dp) + buildField('016', 'CLIENT') + '!';
  const cut = frame.indexOf('!') + 1; // a read that stops right after the '!' in the text
  assert.equal(isCompleteMessage(frame.slice(0, cut)), false);
  assert.equal(isCompleteMessage(frame), true);
  const fields = parseTlv(frame);
  assert.equal(fields['010'], dp);
  assert.equal(fields['016'], 'CLIENT');
});

test('a read ending at a receipt line\'s "?" is not complete', () => {
  const dp = dpBlock('TOTAL?', 'FIN');
  const frame = head + buildField('010', dp) + buildField('016', 'CLIENT') + '!';
  const atLineEnd = frame.slice(0, frame.indexOf('TOTAL?') + 'TOTAL?'.length);
  assert.ok(atLineEnd.endsWith('?'));
  assert.equal(isCompleteMessage(atLineEnd), false);
  // The DP block's own '?' end marker is data too
  const atDpEnd = frame.slice(0, frame.indexOf(buildField('016', 'CLIENT')));
  assert.ok(atDpEnd.endsWith('?'));
  assert.equal(isCompleteMessage(atDpEnd), false);
  assert.equal(isCompleteMessage(frame), true);
});

test('a terminator at a field boundary ends the reply; v1 "?" too', () => {
  assert.equal(isCompleteMessage(head + '!'), true);
  assert.equal(isCompleteMessage(head + '?'), true);
  assert.equal(isCompleteMessage(head), false);
  assert.equal(isCompleteMessage(head.slice(0, 10)), false);
});

test('data that is not TLV falls back to "ends with ! or ?"', () => {
  assert.equal(isCompleteMessage('HELLO!'), true);
  assert.equal(isCompleteMessage(head + 'GARBAGE?'), true);
  assert.equal(isCompleteMessage(head + 'GARBAGE'), false);
});

test('parseTlv stops at a terminator only at a field boundary; trailing data is ignored', () => {
  const fields = parseTlv(head + buildField('033', 'A!B?C') + '!' + buildField('013', '999'));
  assert.equal(fields['033'], 'A!B?C');
  assert.equal(fields['013'], '000');
});

test('DP declared 999 extends to its own "?" end marker', () => {
  const texts = Array.from({ length: 60 }, (_, i) => `LIGNE ${String(i + 1).padStart(2, '0')} ..........`);
  const dp = dpBlock(...texts);
  assert.ok(dp.length > 999, `receipt is ${dp.length} chars`);
  const frame = head + '010999' + dp + buildField('016', 'CLIENT') + '!';

  assert.equal(fieldEnd(frame, head.length), head.length + 6 + dp.length);
  assert.equal(isCompleteMessage(frame), true);
  const fields = parseTlv(frame);
  assert.equal(fields['010'], dp, 'DP value includes its "?"');
  assert.equal(fields['016'], 'CLIENT');
  const receipt = parseReceipt(fields['010'], ReceiptType.MERCHANT);
  assert.equal(receipt.lines.length, 60);
  assert.equal(receipt.lines[59].text, texts[59]);

  // Not received yet: the reader keeps reading
  const partial = frame.slice(0, head.length + 1500);
  assert.equal(fieldEnd(partial, head.length) > partial.length, true);
  assert.equal(isCompleteMessage(partial + '?'), false);
});

test('DP declared 999 that really is 999 long keeps its declared length', () => {
  const text = 'X'.repeat(999 - 28 - 1); // 28 = the four sub-tag headers + DP1-DP3 values
  const dp = line(1, text) + '?';
  assert.equal(dp.length, 999);
  const frame = head + buildField('010', dp) + buildField('016', 'CLIENT') + '!';
  assert.equal(parseTlv(frame)['010'], dp);
  assert.equal(parseTlv(frame)['016'], 'CLIENT');
});

test('only ASCII digits 0-9 are TLV digits; malformed input never throws', () => {
  const arabicIndic = '٠٠١'; // ٠٠١
  const fullwidth = '００１'; // ００１
  for (const bad of [
    arabicIndic + '003101',
    '001' + fullwidth + '1',
    '001-01X',
    '001+01X',
    '001 01X',
    head + '010999' + line(1, 'A') + '*' + '030' + arabicIndic + 'Z',
    '010999?',
    '\u0000\u0000\u0000\u0000\u0000\u0000',
    '!',
    '',
  ]) {
    assert.doesNotThrow(() => parseTlv(bad), JSON.stringify(bad));
    assert.doesNotThrow(() => isCompleteMessage(bad), JSON.stringify(bad));
    assert.doesNotThrow(() => parseReceipt(bad, ReceiptType.MERCHANT), JSON.stringify(bad));
  }
  assert.equal(fieldEnd(arabicIndic + '003101', 0), -1);
  assert.equal(fieldEnd('001' + fullwidth + '1', 0), -1);
  assert.deepEqual(parseTlv(arabicIndic + '003101'), {});
  assert.deepEqual(parseTlv(head + '001-01X'), { '001': '101', '013': '000', '008': '000042' });
  // A receipt sub-tag with a non-ASCII length ends the receipt walk
  const receipt = parseReceipt(line(1, 'OK') + '*030' + fullwidth + '01', ReceiptType.MERCHANT);
  assert.deepEqual(receipt.lines.map((l) => l.text), ['OK']);
});
