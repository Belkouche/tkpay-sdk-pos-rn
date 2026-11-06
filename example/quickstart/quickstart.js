/**
 * Quickstart — the README example, runnable under Node against the emulator.
 *
 *   python3 naps_emulator.py --port 4444
 *   npm run build && node example/quickstart/quickstart.js
 *
 * Set NAPS_PORT to use another emulator port. In a React Native app, drop the
 * nodeTransport line and import from 'react-native-tkpay-naps' instead.
 */
require('./nodeTransport'); // Node only: stands in for the native module
const { NapsPayClient, receiptToPlainText } = require('../../lib');

const client = new NapsPayClient({ host: '127.0.0.1', port: Number(process.env.NAPS_PORT || 4444) });

async function main() {
  const result = await client.processPayment({ amount: 10.5, registerId: '01', cashierId: '00001' });

  if (result.success) {
    console.log(`Approved: STAN ${result.stan}, card ${result.maskedCardNumber}`);
    if (result.customerReceipt) console.log(receiptToPlainText(result.customerReceipt));
  } else {
    console.log(`Declined: CR ${result.responseCode} (${result.error})`);
  }
}

main().catch((e) => console.error(`Payment error: ${e.code} ${e.message}`));
