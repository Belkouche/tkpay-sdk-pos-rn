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
  type SettlementResult,
  type CancellationResult,
  type NetworkTestResult,
  type DuplicateReceiptResult,
  type ResetResult,
  type ReferencingResult,
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
  buildSettlementRequest,
  buildCancellationRequest,
  buildNetworkTestRequest,
  buildDuplicateRequest,
  buildResetRequest,
  buildReferencingRequest,
  parseTlv,
  parseReceipt,
  receiptToPlainText,
  maskCardNumbersInText,
} from './TlvProtocol';
