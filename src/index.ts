/**
 * React Native TKPAY NAPS SDK
 *
 * SDK for integrating NAPS Pay terminals with React Native applications
 */

// Export main client
export { NapsPayClient, maskCardNumber } from './NapsPayClient';

// Export types
export {
  type NapsConfig,
  type PaymentRequest,
  type PaymentResult,
  type Receipt,
  type ReceiptLine,
  ReceiptType,
  Alignment,
  ErrorCode,
  NapsError,
  TLV_TAGS,
  MESSAGE_TYPES,
  CURRENCY,
} from './types';

// Export TLV utilities (for advanced usage)
export {
  buildPaymentRequest,
  buildConfirmationRequest,
  parseTlv,
  parseReceipt,
  receiptToPlainText,
  maskCardNumbersInText,
} from './TlvProtocol';
