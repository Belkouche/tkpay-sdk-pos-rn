# NAPS Terminal Payment Response Examples

This document provides examples of payment response objects returned by the NAPS terminal through the TKPay SDK.

## Successful Payment Response

When a payment is successfully processed, the SDK returns a `PaymentResult` object with the following structure:

```typescript
{
  // Transaction Status
  success: true,
  responseCode: "000",           // "000" indicates approval
  responseMessage: "APPROVED",

  // Card Information (PAN automatically masked)
  maskedPan: "524814******1234", // First 6 + last 4 digits visible
  cardExpiryDate: "2712",        // YYMM format (December 2027)
  cardholderName: "MOHAMMED ALAMI",
  cardEntryMode: "CTLS",         // CTLS = Contactless, ICC = Chip, MSR = Swipe

  // Transaction Identifiers
  stan: "000142",                // System Trace Audit Number (6 digits)
  authorizationNumber: "123456", // Authorization code from issuer
  ncai: "001002",                // Register ID (001) + Cashier ID (002)
  sequenceNumber: "000042",      // Terminal sequence number

  // Transaction Details
  transactionDate: "16012026",   // DDMMYYYY format
  transactionTime: "143052",     // HHMMSS format
  amount: 15000,                 // Amount in centimes (150.00 MAD)
  currency: "MAD",

  // Receipts (formatted text)
  merchantReceipt: `
================================
           TKPAY
      RECU COMMERCANT
================================
Terminal: 12345678
Commercant: CAFE CENTRAL
Date: 16/01/2026  14:30:52
--------------------------------
VENTE SANS CONTACT
Carte: 524814******1234
VISA
--------------------------------
Montant:          150.00 MAD
--------------------------------
CODE AUTORISATION: 123456
STAN: 000142
NCAI: 001002
SEQ: 000042
APPROUVEE
================================
   CONSERVER CE RECU
================================
`,
  customerReceipt: `
================================
           TKPAY
       RECU CLIENT
================================
Date: 16/01/2026  14:30:52
--------------------------------
VENTE SANS CONTACT
Carte: 524814******1234
--------------------------------
Montant:          150.00 MAD
--------------------------------
APPROUVEE
================================
     MERCI DE VOTRE VISITE
================================
`
}
```

## Failed Payment Response

When a payment is declined or fails, the response includes error details:

```typescript
{
  success: false,
  responseCode: "051",
  responseMessage: "INSUFFICIENT FUNDS",

  // Card info may still be present
  maskedPan: "524814******5678",
  cardExpiryDate: "2509",
  cardholderName: "FATIMA BENALI",
  cardEntryMode: "ICC",          // Chip card

  // Transaction identifiers
  stan: "000143",
  authorizationNumber: "",       // Empty on decline
  ncai: "001002",
  sequenceNumber: "000043",

  // Transaction details
  transactionDate: "16012026",
  transactionTime: "144512",
  amount: 50000,                 // 500.00 MAD
  currency: "MAD",

  // Receipts still generated
  merchantReceipt: "...",
  customerReceipt: "..."
}
```

## Common Response Codes

| Code | Message | Description |
|------|---------|-------------|
| `000` | APPROVED | Transaction approved |
| `001` | REFER TO CARD ISSUER | Call issuer for authorization |
| `005` | DO NOT HONOR | Generic decline |
| `012` | INVALID TRANSACTION | Transaction type not supported |
| `014` | INVALID CARD NUMBER | Card number validation failed |
| `041` | LOST CARD | Card reported lost |
| `043` | STOLEN CARD | Card reported stolen |
| `051` | INSUFFICIENT FUNDS | Not enough balance |
| `054` | EXPIRED CARD | Card has expired |
| `055` | INCORRECT PIN | Wrong PIN entered |
| `057` | TXN NOT PERMITTED | Transaction not allowed for card |
| `061` | EXCEEDS LIMIT | Amount exceeds withdrawal limit |
| `065` | EXCEEDS FREQUENCY | Too many transactions |
| `075` | PIN TRIES EXCEEDED | Card blocked after multiple wrong PINs |
| `091` | ISSUER UNAVAILABLE | Bank system offline |
| `096` | SYSTEM MALFUNCTION | Processing error |

## Card Entry Modes

| Mode | Description |
|------|-------------|
| `CTLS` | Contactless (NFC tap) |
| `ICC` | Chip card inserted |
| `MSR` | Magnetic stripe swipe |
| `MANUAL` | Manual card number entry |

## TypeScript Interface

For reference, here is the complete `PaymentResult` interface:

```typescript
interface PaymentResult {
  success: boolean;
  responseCode: string;
  responseMessage: string;
  maskedPan: string;
  cardExpiryDate: string;
  cardholderName: string;
  cardEntryMode: string;
  stan: string;
  authorizationNumber: string;
  ncai: string;
  sequenceNumber: string;
  transactionDate: string;
  transactionTime: string;
  amount: number;
  currency: string;
  merchantReceipt: string;
  customerReceipt: string;
}
```

## Usage Example

```typescript
import { NapsPayClient } from 'react-native-tkpay-naps';

const sdk = new NapsPayClient({
  host: '192.168.1.100',
  port: 4444,
  timeout: 120000, // 2 minutes for card tap
});

try {
  const result = await sdk.processPayment({
    amount: 15000,        // 150.00 MAD in centimes
    registerId: '001',
    cashierId: '002',
  });

  if (result.success) {
    console.log('Payment approved!');
    console.log('Auth code:', result.authorizationNumber);
    // Print customerReceipt
  } else {
    console.log('Payment declined:', result.responseMessage);
    // Show error to user
  }
} catch (error) {
  console.error('Connection error:', error.message);
}
```

## Notes

- **Amount**: Always specified in centimes (smallest currency unit). 150.00 MAD = 15000 centimes.
- **Currency**: Currently only MAD (Moroccan Dirham, code 504) is supported.
- **PAN Masking**: Card numbers are automatically masked by the SDK for PCI compliance.
- **Timeout**: Allow at least 120 seconds for the payment flow to complete (customer may need time to tap/insert card and enter PIN).
- **Merchant Receipt**: Automatically enhanced with STAN, NCAI, and Sequence Number for reconciliation.
