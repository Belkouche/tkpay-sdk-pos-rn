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
  type TotalsResult,
  type Receipt,
  type ReceiptLine,
  ReceiptType,
  Alignment,
  ErrorCode,
  NapsError,
  ProtocolVersion,
  TLV_TAGS,
  MESSAGE_TYPES,
  CURRENCY,
  TIDE,
} from './types';

// Export TLV utilities (for advanced usage)
export {
  buildField,
  buildPaymentRequest,
  buildConfirmationRequest,
  buildSettlementRequest,
  buildCancellationRequest,
  buildCancellationConfirmation,
  buildNetworkTestRequest,
  buildDuplicateRequest,
  buildResetRequest,
  buildReferencingRequest,
  buildTotalsRequest,
  parseTlv,
  parseReceipt,
  fieldEnd,
  isCompleteMessage,
  MAX_RESPONSE_CHARS,
  receiptToPlainText,
  maskCardNumbersInText,
  describeResponseCode,
  isApproved,
  APPROVED_CODES,
  RESPONSE_CODES,
  type ConfirmationOptions,
  type CancellationConfirmationOptions,
} from './TlvProtocol';
