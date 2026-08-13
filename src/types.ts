/**
 * NAPS Pay SDK Types
 */

/**
 * SDK Configuration
 */
export interface NapsConfig {
  /** Terminal IP address */
  host: string;
  /** Terminal port (default: 4444) */
  port?: number;
  /** Request timeout in milliseconds (default: 120000) */
  timeout?: number;
  /** Confirmation timeout in milliseconds (default: 40000) */
  confirmationTimeout?: number;
}

/**
 * Payment Request
 */
export interface PaymentRequest {
  /** Amount in MAD (e.g., 100.00) */
  amount: number;
  /** Register ID (2 digits, e.g., "01") */
  registerId: string;
  /** Cashier ID (5 digits, e.g., "00001") */
  cashierId: string;
  /** Optional sequence number (6 digits) */
  sequence?: string;
}

/**
 * Payment Result
 */
export interface PaymentResult {
  /** Whether payment was successful */
  success: boolean;
  /** Response code (000 = approved) */
  responseCode: string;
  /** System Trace Audit Number */
  stan?: string;
  /** Masked card number (e.g., 516794******3315) */
  maskedCardNumber?: string;
  /** Card expiry (YYMM) */
  cardExpiry?: string;
  /** Cardholder name */
  cardholderName?: string;
  /** Entry mode (e.g., "CTLS" for contactless) */
  entryMode?: string;
  /** Authorization number */
  authNumber?: string;
  /** NCAI (register + cashier) */
  ncai?: string;
  /** Sequence number */
  sequence?: string;
  /** Transaction date (DDMMYYYY) */
  transactionDate?: string;
  /** Transaction time (HHMMSS) */
  transactionTime?: string;
  /** Merchant receipt */
  merchantReceipt?: Receipt;
  /** Customer receipt */
  customerReceipt?: Receipt;
  /** Error message if failed */
  error?: string;
}

/**
 * Receipt
 */
export interface Receipt {
  /** Receipt type */
  type: ReceiptType;
  /** Receipt lines */
  lines: ReceiptLine[];
}

/**
 * Receipt Line
 */
export interface ReceiptLine {
  /** Line number */
  lineNumber: string;
  /** Text content */
  text: string;
  /** Whether text is bold */
  bold: boolean;
  /** Text alignment */
  alignment: Alignment;
}

/**
 * Receipt Type
 */
export enum ReceiptType {
  MERCHANT = 'MERCHANT',
  CUSTOMER = 'CUSTOMER',
}

/**
 * Text Alignment
 */
export enum Alignment {
  LEFT = 'LEFT',
  CENTER = 'CENTER',
  RIGHT = 'RIGHT',
}

/**
 * Error Codes
 */
export enum ErrorCode {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  TIMEOUT = 'TIMEOUT',
  PAYMENT_DECLINED = 'PAYMENT_DECLINED',
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  TERMINAL_DOWN = 'TERMINAL_DOWN',
  TRANSACTION_NOT_FOUND = 'TRANSACTION_NOT_FOUND',
  ALREADY_CANCELLED = 'ALREADY_CANCELLED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * NAPS Error
 */
export class NapsError extends Error {
  code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'NapsError';
  }

  static connectionFailed(cause?: string): NapsError {
    return new NapsError(
      ErrorCode.CONNECTION_FAILED,
      cause || 'Failed to connect to NAPS Pay terminal'
    );
  }

  static timeout(): NapsError {
    return new NapsError(ErrorCode.TIMEOUT, 'Request timeout');
  }

  static invalidResponse(message: string): NapsError {
    return new NapsError(ErrorCode.INVALID_RESPONSE, message);
  }

  static terminalDown(): NapsError {
    return new NapsError(ErrorCode.TERMINAL_DOWN, 'Terminal or server is down');
  }
}

/**
 * TLV Tags
 */
export const TLV_TAGS = {
  TM: '001',    // Message Type (3)
  MT: '002',    // Amount in minor units (12)
  NCAI: '003',  // Terminal Number: Register(2) + Cashier(5) (7)
  NS: '004',    // Sequence Number (6)
  NSA: '005',   // Cancellation Sequence Number (6)
  NHC: '006',   // Hostess Number (2)
  NCAR: '007',  // Card Number - masked (16)
  STAN: '008',  // System Trace Audit Number (6)
  NA: '009',    // Authorization Number (6)
  DP: '010',    // Printable Data / Receipt (3500)
  CB: '011',    // Barcode (100)
  DE: '012',    // Currency Code (3)
  CR: '013',    // Response Code (3)
  DA: '014',    // Date (8)
  HE: '015',    // Time (6)
  NPRT: '016',  // Cardholder Name (48)
  DAEX: '017',  // Card Expiration Date YYMM (4)
  DATR: '018',  // Transaction Date DDMMYYYY (8)
  HETR: '019',  // Transaction Time HHMMSS (6)
  TIDE: '020',  // Ticket Type (2)
  TYPA: '021',  // Transaction Type (1)
  RE: '022',    // Receipt Data (256)
  RECB: '023',  // Receipt Copy (25)
  REQU: '024',  // Request Type (2)
  RESE: '025',  // Response Message (25)
  RECO: '026',  // Receipt Confirmation (25)
  RERA: '027',  // Response Reason (2)
  MDLC: '028',  // Model Code (3)
  EM: '040',    // Entry Mode (3)
} as const;

/**
 * Receipt Sub-tags
 */
export const RECEIPT_TAGS = {
  LINE_NUMBER: '030',
  FORMAT: '031',
  ALIGNMENT: '032',
  CONTENT: '033',
} as const;

/**
 * Settlement Result
 */
export interface SettlementResult {
  /** Whether settlement was successful */
  success: boolean;
  /** Response code (000 = success) */
  responseCode: string;
  /** Settlement date (DDMMYYYY) */
  date?: string;
  /** Settlement time (HHMMSS) */
  time?: string;
  /** Settlement receipt */
  receipt?: Receipt;
  /** Error message if failed */
  error?: string;
}

/**
 * Cancellation Result (TM=003)
 */
export interface CancellationResult {
  /** Whether cancellation was accepted */
  success: boolean;
  /** Response code (000 = accepted) */
  responseCode: string;
  /** STAN of the cancelled transaction */
  stan?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Network Test Result (TM=009)
 */
export interface NetworkTestResult {
  /** Whether terminal responded with RC=000 */
  success: boolean;
  /** Response code */
  responseCode: string;
  /** Round-trip time in milliseconds */
  rttMs?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Duplicate Receipt Result (TM=008)
 */
export interface DuplicateReceiptResult {
  /** Whether duplicate was returned */
  success: boolean;
  /** Response code */
  responseCode: string;
  /** Merchant receipt */
  merchantReceipt?: Receipt;
  /** Error message if failed */
  error?: string;
}

/**
 * Reset PinPAD Result (TM=012)
 */
export interface ResetResult {
  /** Whether reset was accepted */
  success: boolean;
  /** Response code */
  responseCode: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Referencing Result (TM=013)
 */
export interface ReferencingResult {
  /** Whether referencing succeeded */
  success: boolean;
  /** Response code */
  responseCode: string;
  /** Referencing/config receipt */
  receipt?: Receipt;
  /** Error message if failed */
  error?: string;
}

/**
 * Message Types
 */
export const MESSAGE_TYPES = {
  PAYMENT_REQUEST: '001',
  PAYMENT_RESPONSE: '101',
  CONFIRMATION_REQUEST: '002',
  CONFIRMATION_RESPONSE: '102',
  CANCELLATION_REQUEST: '003',
  CANCELLATION_RESPONSE: '103',
  CANCELLATION_CONFIRMATION_REQUEST: '004',
  CANCELLATION_CORRECTION: '104',
  DUPLICATE_REQUEST: '008',
  DUPLICATE_RESPONSE: '108',
  NETWORK_TEST_REQUEST: '009',
  NETWORK_TEST_RESPONSE: '109',
  SETTLEMENT_REQUEST: '010',
  SETTLEMENT_RESPONSE: '110',
  RESET_REQUEST: '012',
  RESET_RESPONSE: '112',
  REFERENCING_REQUEST: '013',
  REFERENCING_RESPONSE: '113',
} as const;

/**
 * Currency Codes
 */
export const CURRENCY = {
  MAD: '504',
} as const;
