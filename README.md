# React Native TKPAY NAPS SDK

React Native SDK for integrating NAPS Pay terminals with your mobile applications.

[![GitHub](https://img.shields.io/badge/GitHub-tkpay--sdk--pos--rn-blue)](https://github.com/Belkouche/tkpay-sdk-pos-rn)

## Features

- **M2M Protocol Support** - Full implementation of NAPS Pay M2M TLV protocol
- **Cross-Platform** - Works on both iOS and Android
- **TypeScript** - Full TypeScript support with type definitions
- **PCI-DSS Compliant** - Automatic PAN masking (first 6 + last 4 digits)
- **Receipt Parsing** - Parse and format merchant/customer receipts
- **TKPAY Branding** - Automatic branding on receipts
- **Async/Await** - Modern Promise-based API

## Installation

```bash
npm install github:Belkouche/tkpay-sdk-pos-rn
# or
yarn add github:Belkouche/tkpay-sdk-pos-rn
```

### iOS Setup

```bash
cd ios && pod install
```

### Android Setup

No additional setup required. The module auto-links.

## Quick Start

### 1. Import the SDK

```typescript
import {
  NapsPayClient,
  type PaymentRequest,
  type PaymentResult,
  NapsError,
  ErrorCode,
} from 'react-native-tkpay-naps';
```

### 2. Initialize the Client

```typescript
const client = new NapsPayClient({
  host: '192.168.24.214', // Terminal IP address
  port: 4444,             // M2M port (default)
  timeout: 120000,        // Request timeout (2 minutes)
  confirmationTimeout: 40000, // Confirmation timeout (40 seconds)
});
```

### 3. Process a Payment

```typescript
async function processPayment() {
  try {
    const request: PaymentRequest = {
      amount: 100.00,       // Amount in MAD
      registerId: '01',     // Register ID (2 digits)
      cashierId: '00001',   // Cashier ID (5 digits)
    };

    const result = await client.processPayment(request);

    if (result.success) {
      console.log('Payment Approved!');
      console.log('STAN:', result.stan);
      console.log('Card:', result.maskedCardNumber); // 516794******3315
      console.log('Auth:', result.authNumber);

      // Display receipts
      if (result.merchantReceipt) {
        displayReceipt(result.merchantReceipt);
      }
    } else {
      console.log('Payment Failed:', result.error);
    }

  } catch (error) {
    if (error instanceof NapsError) {
      switch (error.code) {
        case ErrorCode.CONNECTION_FAILED:
          console.log('Cannot connect to terminal');
          break;
        case ErrorCode.TIMEOUT:
          console.log('Transaction timeout');
          break;
        default:
          console.log('Error:', error.message);
      }
    }
  }
}
```

### 4. Display Receipt

```typescript
import { receiptToPlainText, type Receipt } from 'react-native-tkpay-naps';

function displayReceipt(receipt: Receipt) {
  // Get plain text version
  const text = receiptToPlainText(receipt, 40);
  console.log(text);

  // Or iterate lines for custom formatting
  receipt.lines.forEach(line => {
    console.log({
      text: line.text,
      bold: line.bold,
      alignment: line.alignment, // 'LEFT' | 'CENTER' | 'RIGHT'
    });
  });
}
```

### 5. Test Connection

```typescript
async function checkTerminal() {
  const isConnected = await client.testConnection();
  if (isConnected) {
    console.log('Terminal is reachable');
  } else {
    console.log('Cannot connect to terminal');
  }
}
```

## React Native Example

```tsx
import React, { useState } from 'react';
import { View, Text, Button, Alert, ActivityIndicator } from 'react-native';
import {
  NapsPayClient,
  type PaymentResult,
  NapsError,
} from 'react-native-tkpay-naps';

const client = new NapsPayClient({
  host: '192.168.24.214',
});

export default function PaymentScreen() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PaymentResult | null>(null);

  const handlePayment = async () => {
    setLoading(true);
    try {
      const paymentResult = await client.processPayment({
        amount: 100.00,
        registerId: '01',
        cashierId: '00001',
      });

      setResult(paymentResult);

      if (paymentResult.success) {
        Alert.alert('Success', `Payment approved!\nSTAN: ${paymentResult.stan}`);
      } else {
        Alert.alert('Failed', paymentResult.error || 'Payment declined');
      }
    } catch (error) {
      if (error instanceof NapsError) {
        Alert.alert('Error', error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <Text style={{ fontSize: 24, marginBottom: 20 }}>NAPS Pay Demo</Text>

      <Button
        title={loading ? 'Processing...' : 'Pay 100 MAD'}
        onPress={handlePayment}
        disabled={loading}
      />

      {loading && <ActivityIndicator style={{ marginTop: 20 }} />}

      {result && (
        <View style={{ marginTop: 20 }}>
          <Text>Status: {result.success ? 'Approved' : 'Declined'}</Text>
          {result.stan && <Text>STAN: {result.stan}</Text>}
          {result.maskedCardNumber && <Text>Card: {result.maskedCardNumber}</Text>}
        </View>
      )}
    </View>
  );
}
```

## API Reference

### NapsPayClient

#### Constructor

```typescript
new NapsPayClient(config: NapsConfig)
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `host` | `string` | *required* | Terminal IP address |
| `port` | `number` | `4444` | M2M port |
| `timeout` | `number` | `120000` | Request timeout (ms) |
| `confirmationTimeout` | `number` | `40000` | Confirmation timeout (ms) |

#### Methods

##### `processPayment(request: PaymentRequest): Promise<PaymentResult>`

Process a complete payment transaction (two-phase flow).

##### `testConnection(): Promise<boolean>`

Test connection to terminal.

### PaymentRequest

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `amount` | `number` | Yes | Amount in MAD |
| `registerId` | `string` | Yes | Register ID (2 digits) |
| `cashierId` | `string` | Yes | Cashier ID (5 digits) |
| `sequence` | `string` | No | Sequence number (6 digits) |

### PaymentResult

| Property | Type | Description |
|----------|------|-------------|
| `success` | `boolean` | Whether payment was approved |
| `responseCode` | `string` | Response code (000 = approved) |
| `stan` | `string?` | System Trace Audit Number |
| `maskedCardNumber` | `string?` | Masked card number |
| `authNumber` | `string?` | Authorization number |
| `merchantReceipt` | `Receipt?` | Merchant receipt |
| `customerReceipt` | `Receipt?` | Customer receipt |
| `error` | `string?` | Error message if failed |

## Response Codes

| Code | Description |
|------|-------------|
| `000` | Approved |
| `909` | Terminal or server down |
| `302` | Transaction not found |
| `482` | Transaction already cancelled |
| `480` | Transaction cancelled |

## Payment Flow

```
┌─────────────┐          ┌──────────────┐          ┌─────────────┐
│  Your App   │          │     SDK      │          │  Terminal   │
└──────┬──────┘          └──────┬───────┘          └──────┬──────┘
       │                        │                         │
       │  processPayment()      │                         │
       │───────────────────────>│                         │
       │                        │  Phase 1: TM 001        │
       │                        │────────────────────────>│
       │                        │     Customer taps card  │
       │                        │  Response: TM 101       │
       │                        │<────────────────────────│
       │                        │  Phase 2: TM 002        │
       │                        │────────────────────────>│
       │                        │  Response: TM 102       │
       │                        │<────────────────────────│
       │  PaymentResult         │                         │
       │<───────────────────────│                         │
```

## Security

- **PAN Masking**: Card numbers automatically masked (516794******3315)
- **No Storage**: SDK never stores sensitive card data
- **Secure Logging**: Raw TLV data not logged
- **PCI-DSS**: Compliant with payment card industry standards

## Requirements

- React Native 0.60+
- iOS 12.0+
- Android API 21+ (Android 5.0)

## Permissions

### Android

Add to `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

### iOS

Network access is allowed by default.

## Troubleshooting

### Connection Issues

1. Ensure terminal is on the same network as your device
2. Verify terminal IP address is correct
3. Check that NAPS Pay app is running on terminal
4. Confirm port 4444 is accessible

### Timeout Issues

- Phase 2 confirmation must be sent within 40 seconds
- Increase `timeout` for slow networks

## License

Copyright 2025 TKPAY. All rights reserved.

## Support

- GitHub Issues: https://github.com/Belkouche/tkpay-sdk-pos-rn/issues
- Email: support@tkpay.ma
