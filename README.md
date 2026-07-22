# react-native-tkpay-naps

React Native SDK for integrating **NAPS Pay POS terminals** into your mobile application.

Implements the full **NAPS M2M TLV protocol** — the same binary protocol used by physical SUNMI terminals in production. Works on iOS and Android. Full TypeScript support.

[![npm version](https://img.shields.io/badge/version-1.1.0-blue)](https://github.com/Belkouche/tkpay-sdk-pos-rn)
[![platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey)](https://github.com/Belkouche/tkpay-sdk-pos-rn)

---

## Table of Contents

1. [How it works](#how-it-works)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [API Reference](#api-reference)
   - [processPayment](#processpayment)
   - [cancelPayment](#cancelpayment)
   - [networkTest](#networktest)
   - [printDuplicate](#printduplicate)
   - [resetPinPad](#resetpinpad)
   - [referencing](#referencing)
   - [settlement](#settlement)
   - [testConnection](#testconnection)
5. [Receipts](#receipts)
6. [Error Handling](#error-handling)
7. [Response Codes](#response-codes)
8. [Full Example App](#full-example-app)
9. [Permissions](#permissions)
10. [Troubleshooting](#troubleshooting)

---

## How it works

The NAPS terminal speaks a **two-phase TCP protocol** on port 4444. Your app connects over WiFi or LAN and exchanges TLV (Tag-Length-Value) messages.

```
Your App                       SDK                        Terminal (port 4444)
   │                            │                               │
   │  processPayment(100 MAD)   │                               │
   │──────────────────────────> │                               │
   │                            │── Phase 1: TM=001 ──────────>│
   │                            │   (amount, cashier info)      │
   │                            │                    [customer taps card]
   │                            │<─ TM=101 (RC=000, STAN) ─────│
   │                            │── Phase 2: TM=002 ──────────>│  ← same TCP connection
   │                            │<─ TM=102 (receipt) ──────────│
   │<── PaymentResult ──────────│                               │
   │    { success, stan,        │                               │
   │      maskedCard, receipt } │                               │
```

**Phase 1** asks the terminal to collect the card. The customer taps or inserts their card. The terminal returns a response code and a STAN (System Trace Audit Number).

**Phase 2** confirms the transaction on the **same TCP connection**. The terminal prints the receipt and considers the transaction complete.

> **Important:** Phase 2 must be sent within **40 seconds** of Phase 1, on the same open socket. The SDK handles this automatically.

---

## Installation

```bash
npm install github:Belkouche/tkpay-sdk-pos-rn
# or
yarn add github:Belkouche/tkpay-sdk-pos-rn
```

### iOS

```bash
cd ios && pod install
```

### Android

No extra steps — the native module auto-links.

---

## Quick Start

### Step 1 — Import and configure

```typescript
import { NapsPayClient, NapsError, ErrorCode } from 'react-native-tkpay-naps';

// Create one client per terminal. Reuse it across your app.
const client = new NapsPayClient({
  host: '192.168.1.100', // Terminal IP on your local network
  port: 4444,            // Default NAPS M2M port
});
```

### Step 2 — First run: referencing

Before the very first payment, call `referencing()` once. This downloads the merchant configuration (MID, TID, currency) from the NAPS server.

```typescript
const ref = await client.referencing('01', '00001');
if (!ref.success) {
  console.error('Referencing failed:', ref.error);
  return;
}
// Terminal is now configured. You only need to do this once per session.
```

### Step 3 — Process a payment

```typescript
const result = await client.processPayment({
  amount: 150.00,      // MAD — decimals are fine (150.00, 89.50, etc.)
  registerId: '01',   // 2-digit register/POS ID
  cashierId: '00001', // 5-digit cashier ID
});

if (result.success) {
  console.log('Approved! STAN:', result.stan);
  console.log('Card:', result.maskedCardNumber); // e.g. 516794******3315
} else {
  console.log('Declined:', result.error);
}
```

That's it. The SDK handles Phase 1, waits for the customer to tap, sends Phase 2, and returns the result.

---

## API Reference

### `NapsPayClient(config)`

```typescript
const client = new NapsPayClient({
  host: string,                 // Required — terminal IP address
  port?: number,                // Default: 4444
  timeout?: number,             // Default: 120000 ms (2 min) — time to wait for card tap
  confirmationTimeout?: number, // Default: 40000 ms — Phase 2 window
});
```

---

### `processPayment`

**The main method.** Runs the full two-phase payment flow.

```typescript
const result = await client.processPayment({
  amount: number,      // Amount in MAD (e.g. 100, 89.50)
  registerId: string,  // 2 digits, e.g. '01'
  cashierId: string,   // 5 digits, e.g. '00001'
  sequence?: string,   // 6 digits — auto-generated if omitted
});
```

**Returns `PaymentResult`:**

```typescript
{
  success: boolean,
  responseCode: string,       // '000' = approved
  stan?: string,              // System Trace Audit Number — save this for cancellation
  maskedCardNumber?: string,  // e.g. '516794******3315'
  cardExpiry?: string,        // 'YYMM'
  authNumber?: string,        // Authorization number
  entryMode?: string,         // 'CTLS' (contactless), 'ICC' (chip), 'SWIPE'
  transactionDate?: string,   // 'DDMMYYYY'
  transactionTime?: string,   // 'HHMMSS'
  merchantReceipt?: Receipt,
  customerReceipt?: Receipt,
  error?: string,             // Human-readable error if success=false
}
```

---

### `cancelPayment`

Voids a previously approved transaction by its STAN. Must be called **before end-of-day settlement**.

```typescript
const result = await client.cancelPayment(
  stan,        // STAN from the PaymentResult you want to cancel
  registerId,  // Same register ID used for the original payment
  cashierId,   // Same cashier ID
  sequence,    // Same sequence number
);
```

> **Note:** Cancellation opens a **new TCP connection** (not the same socket as the original payment). The SDK handles this.

**Returns `CancellationResult`:**

```typescript
{
  success: boolean,
  responseCode: string,
  stan?: string,   // Confirmed STAN of the cancelled transaction
  error?: string,
}
```

**Example flow — pay then cancel:**

```typescript
// Pay
const payment = await client.processPayment({ amount: 100, registerId: '01', cashierId: '00001' });

// Cancel it (e.g. customer changed their mind)
if (payment.success && payment.stan) {
  const cancel = await client.cancelPayment(payment.stan, '01', '00001', payment.sequence!);
  console.log(cancel.success ? 'Cancelled' : 'Cancel failed: ' + cancel.error);
}
```

---

### `networkTest`

Sends a **TM=009 M2M network test** to the terminal and measures the round-trip time.

Unlike `testConnection()` which only opens a TCP socket, `networkTest()` sends a real protocol message. Use it on your diagnostics screen or before critical operations.

```typescript
const test = await client.networkTest('01', '00001');

console.log(test.success);  // true/false
console.log(test.rttMs);    // e.g. 4 — round-trip in milliseconds
console.log(test.error);    // set if success=false
```

**Returns `NetworkTestResult`:**

```typescript
{
  success: boolean,
  responseCode: string,
  rttMs?: number,   // Round-trip time in milliseconds
  error?: string,
}
```

---

### `printDuplicate`

Asks the terminal to **reprint the last receipt**. Pass a `stan` to reprint a specific transaction.

```typescript
// Reprint last transaction
const dup = await client.printDuplicate('01', '00001');

// Reprint a specific transaction
const dup = await client.printDuplicate('01', '00001', '635279');

if (dup.success && dup.merchantReceipt) {
  const text = receiptToPlainText(dup.merchantReceipt);
  console.log(text);
}
```

**Returns `DuplicateReceiptResult`:**

```typescript
{
  success: boolean,
  responseCode: string,
  merchantReceipt?: Receipt,
  error?: string,
}
```

---

### `resetPinPad`

Sends **TM=012** to reset the terminal to idle state ("Attente Caisse").

Use this if the terminal is stuck on a card-waiting screen after a network error or app crash.

```typescript
const reset = await client.resetPinPad('01', '00001');
console.log(reset.success ? 'Terminal reset' : reset.error);
```

**Returns `ResetResult`:**

```typescript
{
  success: boolean,
  responseCode: string,
  error?: string,
}
```

---

### `referencing`

Sends **TM=013** to sync merchant configuration from the NAPS server.

**When to call it:**
- Once at app startup (before the first payment of the day)
- After a terminal swap or configuration change
- When the terminal reports configuration errors

```typescript
const ref = await client.referencing('01', '00001');

if (ref.success) {
  console.log('Terminal configured');
  // ref.receipt contains MID, TID, currency info
}
```

**Returns `ReferencingResult`:**

```typescript
{
  success: boolean,
  responseCode: string,
  receipt?: Receipt,  // Contains MID, TID, merchant name, currency
  error?: string,
}
```

---

### `settlement`

Sends **TM=010** to trigger end-of-day telecollecte (batch settlement).

```typescript
const settle = await client.settlement('01', '00001');

if (settle.success) {
  console.log('Settlement complete');
  // settle.receipt contains daily totals
}
```

**Returns `SettlementResult`:**

```typescript
{
  success: boolean,
  responseCode: string,
  date?: string,
  time?: string,
  receipt?: Receipt,
  error?: string,
}
```

---

### `testConnection`

TCP-level connectivity check (no protocol message). Quick way to know if the terminal IP is reachable.

```typescript
const reachable = await client.testConnection();
// true = port 4444 is open, false = unreachable
```

> For a full protocol-level health check, use `networkTest()` instead.

---

## Receipts

The terminal returns receipts as structured objects. Use `receiptToPlainText()` to render them, or iterate `lines` for custom UI.

```typescript
import { receiptToPlainText, Alignment } from 'react-native-tkpay-naps';

// Plain text (for logging or monospace display)
const text = receiptToPlainText(result.merchantReceipt!, 40);
console.log(text);

// Custom rendering
result.merchantReceipt!.lines.forEach(line => {
  console.log({
    text: line.text,
    bold: line.bold,                    // true = gras
    alignment: line.alignment,          // Alignment.LEFT | CENTER | RIGHT
  });
});
```

**Receipt types:**

- `result.merchantReceipt` — copy for the merchant (kept in register)
- `result.customerReceipt` — copy for the customer (printed and handed over)

---

## Error Handling

The SDK throws `NapsError` for protocol-level failures. Payment declines are **not** errors — they come back as `result.success = false` with a `responseCode`.

```typescript
import { NapsError, ErrorCode } from 'react-native-tkpay-naps';

try {
  const result = await client.processPayment({ ... });

  if (result.success) {
    // Payment approved
  } else {
    // Declined by the bank — show result.error to user
    console.log('Declined:', result.responseCode, result.error);
  }

} catch (error) {
  if (error instanceof NapsError) {
    switch (error.code) {
      case ErrorCode.CONNECTION_FAILED:
        // Terminal unreachable — check IP and network
        break;
      case ErrorCode.TIMEOUT:
        // Customer didn't tap within timeout — safe to retry
        break;
      case ErrorCode.TERMINAL_DOWN:
        // RC=909 — terminal or NAPS server is down
        break;
      default:
        console.error(error.message);
    }
  }
}
```

**ErrorCode values:**

| Code | When |
|------|------|
| `CONNECTION_FAILED` | Cannot open TCP socket to terminal |
| `TIMEOUT` | No response within `timeout` ms |
| `TERMINAL_DOWN` | RC=909 from terminal |
| `TRANSACTION_NOT_FOUND` | RC=302 |
| `ALREADY_CANCELLED` | RC=482 |
| `INVALID_RESPONSE` | Malformed TLV from terminal |
| `UNKNOWN_ERROR` | Unexpected error |

---

## Response Codes

| Code | Meaning |
|------|---------|
| `000` | Approved |
| `100` | Do not honour |
| `101` | Expired card |
| `102` | Suspected fraud |
| `106` | PIN attempts exceeded |
| `116` | Insufficient funds |
| `117` | Wrong PIN |
| `118` | Card not active |
| `120` | Transaction not allowed at terminal |
| `121` | Exceeds withdrawal limits |
| `265` | Please use chip |
| `280` | Cancelled by cardholder |
| `281` | PIN verification failed |
| `302` | Transaction not found |
| `482` | Already cancelled |
| `909` | System failure / terminal down |
| `912` | Card issuer unavailable |
| `995` | Server processing error |

---

## Full Example App

```tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import {
  NapsPayClient,
  NapsError,
  receiptToPlainText,
  type PaymentResult,
} from 'react-native-tkpay-naps';

const REGISTER_ID = '01';
const CASHIER_ID  = '00001';

export default function PaymentScreen() {
  const [host, setHost]     = useState('192.168.1.100');
  const [amount, setAmount] = useState('100');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<PaymentResult | null>(null);
  const [log, setLog]         = useState<string[]>([]);

  const addLog = (msg: string) =>
    setLog(prev => [`${new Date().toLocaleTimeString()} ${msg}`, ...prev]);

  const getClient = () => new NapsPayClient({ host });

  const handleReferencing = async () => {
    setLoading(true);
    addLog('Referencing terminal...');
    const ref = await getClient().referencing(REGISTER_ID, CASHIER_ID);
    addLog(ref.success ? '✓ Terminal configured' : `✗ ${ref.error}`);
    setLoading(false);
  };

  const handleNetworkTest = async () => {
    setLoading(true);
    const test = await getClient().networkTest(REGISTER_ID, CASHIER_ID);
    addLog(test.success
      ? `✓ Terminal alive (${test.rttMs}ms)`
      : `✗ Network test failed: ${test.error}`);
    setLoading(false);
  };

  const handlePayment = async () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Error', 'Enter a valid amount');
      return;
    }
    setLoading(true);
    setResult(null);
    addLog(`Processing ${amt} MAD...`);
    try {
      const r = await getClient().processPayment({
        amount: amt,
        registerId: REGISTER_ID,
        cashierId: CASHIER_ID,
      });
      setResult(r);
      addLog(r.success ? `✓ Approved STAN=${r.stan}` : `✗ Declined RC=${r.responseCode}`);
    } catch (e) {
      addLog(`✗ ${e instanceof NapsError ? e.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!result?.success || !result.stan) {
      Alert.alert('Nothing to cancel');
      return;
    }
    setLoading(true);
    addLog(`Cancelling STAN=${result.stan}...`);
    const cancel = await getClient().cancelPayment(
      result.stan, REGISTER_ID, CASHIER_ID, result.sequence ?? '000001'
    );
    addLog(cancel.success ? '✓ Cancelled' : `✗ ${cancel.error}`);
    if (cancel.success) setResult(null);
    setLoading(false);
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>NAPS Pay</Text>

      <Text style={styles.label}>Terminal IP</Text>
      <TextInput style={styles.input} value={host} onChangeText={setHost} />

      <Text style={styles.label}>Amount (MAD)</Text>
      <TextInput
        style={styles.input} value={amount} onChangeText={setAmount}
        keyboardType="decimal-pad"
      />

      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, styles.secondary]} onPress={handleNetworkTest} disabled={loading}>
          <Text style={styles.btnText}>Test</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.secondary]} onPress={handleReferencing} disabled={loading}>
          <Text style={styles.btnText}>Setup</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.primary]} onPress={handlePayment} disabled={loading}>
          <Text style={styles.btnText}>Pay</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator size="large" color="#FF6B35" style={{ marginTop: 20 }} />}

      {result?.success && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>✅ Approved</Text>
          <Text>STAN: {result.stan}</Text>
          <Text>Card: {result.maskedCardNumber}</Text>
          <Text>Auth: {result.authNumber}</Text>
          {result.merchantReceipt && (
            <Text style={styles.receipt}>{receiptToPlainText(result.merchantReceipt)}</Text>
          )}
          <TouchableOpacity style={[styles.btn, styles.danger, { marginTop: 10 }]} onPress={handleCancel} disabled={loading}>
            <Text style={styles.btnText}>Cancel this payment</Text>
          </TouchableOpacity>
        </View>
      )}

      {result && !result.success && (
        <View style={[styles.card, styles.declined]}>
          <Text style={styles.cardTitle}>❌ Declined</Text>
          <Text>{result.error} (RC={result.responseCode})</Text>
        </View>
      )}

      <View style={styles.logBox}>
        {log.map((l, i) => <Text key={i} style={styles.logLine}>{l}</Text>)}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  title:      { fontSize: 28, fontWeight: 'bold', color: '#FF6B35', textAlign: 'center', marginBottom: 24 },
  label:      { fontSize: 13, color: '#666', marginBottom: 4 },
  input:      { backgroundColor: '#fff', borderRadius: 8, padding: 12, fontSize: 16, borderWidth: 1, borderColor: '#ddd', marginBottom: 12 },
  row:        { flexDirection: 'row', gap: 8, marginBottom: 16 },
  btn:        { flex: 1, padding: 14, borderRadius: 8, alignItems: 'center' },
  primary:    { backgroundColor: '#FF6B35' },
  secondary:  { backgroundColor: '#555' },
  danger:     { backgroundColor: '#d32f2f' },
  btnText:    { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  card:       { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 16, borderLeftWidth: 4, borderLeftColor: '#4CAF50' },
  declined:   { borderLeftColor: '#d32f2f' },
  cardTitle:  { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  receipt:    { fontFamily: 'monospace', fontSize: 12, marginTop: 10, backgroundColor: '#f9f9f9', padding: 8, borderRadius: 4 },
  logBox:     { backgroundColor: '#1e1e1e', borderRadius: 8, padding: 12, marginTop: 20, marginBottom: 40 },
  logLine:    { color: '#adb5bd', fontSize: 12, fontFamily: 'monospace', marginBottom: 2 },
});
```

---

## Permissions

### Android (`AndroidManifest.xml`)

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

### iOS

No additional permissions needed. The app communicates over the local network by default.

---

## Troubleshooting

**Cannot connect to terminal**
- Terminal and phone must be on the **same WiFi network**
- Run `networkTest()` to verify connectivity
- Check that the NAPS Pay app is running on the terminal (it must be in "Attente Caisse" state)
- Verify the IP address in your network settings

**Payment always times out**
- The customer has `timeout` milliseconds (default: 2 min) to tap their card
- If the terminal doesn't respond at all, try `resetPinPad()` then reconnect

**"Referencing failed"**
- The terminal can't reach the NAPS server — check the terminal's mobile/WiFi data connection
- Try again after a few seconds

**Terminal stuck on card-waiting screen**
- Call `resetPinPad()` to bring it back to idle state
- If that doesn't work, restart the NAPS Pay app on the terminal

**Phase 2 confirmation timeout**
- The SDK auto-sends Phase 2 immediately after Phase 1 — this should not normally happen
- If it does, increase `confirmationTimeout` (max 40 seconds is the NAPS protocol limit)

---

## Requirements

- React Native 0.60+
- iOS 12.0+
- Android API 21+ (Android 5.0)

## Security

- Card numbers (PAN) are **automatically masked** at the SDK layer (first 6 + last 4 digits)
- Raw TLV data is never logged
- The SDK never stores sensitive card data

## License

Copyright 2025 TKpay. All rights reserved.

## Support

- GitHub Issues: https://github.com/Belkouche/tkpay-sdk-pos-rn/issues
- Email: support@tkpay.ma
