/**
 * Test script for TLV Protocol
 * Tests the SDK's protocol logic without native modules
 */

const {
  buildPaymentRequest,
  buildConfirmationRequest,
  parseTlv,
  maskCardNumber,
  parseReceipt,
  receiptToPlainText
} = require('./lib/TlvProtocol');

console.log('=== TKPAY NAPS SDK Protocol Tests ===\n');

// Test 1: Build Payment Request
console.log('1. Testing buildPaymentRequest()');
const paymentRequest = buildPaymentRequest(100.50, '0100001', '000001');
console.log('   Amount: 100.50 MAD');
console.log('   NCAI: 0100001 (Register 01, Cashier 00001)');
console.log('   Sequence: 000001');
console.log('   TLV Output:', paymentRequest);
console.log('   Length:', paymentRequest.length, 'chars\n');

// Test 2: Build Confirmation Request
console.log('2. Testing buildConfirmationRequest()');
const confirmRequest = buildConfirmationRequest('123456', '0100001', '000001');
console.log('   STAN: 123456');
console.log('   TLV Output:', confirmRequest);
console.log('   Length:', confirmRequest.length, 'chars\n');

// Test 3: Parse TLV Response
console.log('3. Testing parseTlv()');
const sampleResponse = '001003101008006123456007016516794012345331513003000';
const parsed = parseTlv(sampleResponse);
console.log('   Input:', sampleResponse);
console.log('   Parsed fields:');
for (const [tag, value] of Object.entries(parsed)) {
  console.log(`     Tag ${tag}: "${value}"`);
}
console.log('');

// Test 4: Card Number Masking
console.log('4. Testing maskCardNumber()');
const testCards = [
  '5167940123453315',
  '4111111111111111',
  '378282246310005',
  '123456'
];
for (const card of testCards) {
  console.log(`   ${card} -> ${maskCardNumber(card)}`);
}
console.log('');

// Test 5: Verify timeout configuration
console.log('5. Timeout Configuration Test');
const clientDBTimeout = 60; // seconds
const clientDBConfirmationTimeout = 20; // seconds

// Customer's code (potentially wrong)
const wrongTimeout = clientDBTimeout * 2000;
const wrongConfirmTimeout = clientDBConfirmationTimeout * 2000;

// Correct conversion
const correctTimeout = clientDBTimeout * 1000;
const correctConfirmTimeout = clientDBConfirmationTimeout * 1000;

console.log('   If clientDB values are in SECONDS:');
console.log(`   - clientDB.timeout = ${clientDBTimeout}`);
console.log(`   - clientDB.confirmationTimeout = ${clientDBConfirmationTimeout}`);
console.log('');
console.log('   Customer code (* 2000):');
console.log(`   - timeout: ${wrongTimeout}ms (${wrongTimeout/1000}s) ${wrongTimeout > 120000 ? '⚠️ Too long!' : ''}`);
console.log(`   - confirmationTimeout: ${wrongConfirmTimeout}ms (${wrongConfirmTimeout/1000}s) ${wrongConfirmTimeout > 40000 ? '⚠️ Exceeds 40s limit!' : ''}`);
console.log('');
console.log('   Correct code (* 1000):');
console.log(`   - timeout: ${correctTimeout}ms (${correctTimeout/1000}s) ✓`);
console.log(`   - confirmationTimeout: ${correctConfirmTimeout}ms (${correctConfirmTimeout/1000}s) ✓`);
console.log('');

// Test 6: What if clientDB values are already in ms?
console.log('6. If clientDB values are already in MILLISECONDS:');
const clientDBTimeoutMs = 60000; // ms
const clientDBConfirmTimeoutMs = 30000; // ms

const wrongTimeoutMs = clientDBTimeoutMs * 2000;
const wrongConfirmTimeoutMs = clientDBConfirmTimeoutMs * 2000;

console.log(`   - clientDB.timeout = ${clientDBTimeoutMs}ms`);
console.log(`   - clientDB.confirmationTimeout = ${clientDBConfirmTimeoutMs}ms`);
console.log('');
console.log('   Customer code (* 2000):');
console.log(`   - timeout: ${wrongTimeoutMs}ms (${wrongTimeoutMs/1000/60} minutes!) ⚠️ WAY too long!`);
console.log(`   - confirmationTimeout: ${wrongConfirmTimeoutMs}ms (${wrongConfirmTimeoutMs/1000/60} minutes!) ⚠️ WAY too long!`);
console.log('');

console.log('=== Tests Complete ===');
