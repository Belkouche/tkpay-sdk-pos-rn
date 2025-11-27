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
  TM: '001', // Message Type
  MT: '002', // Amount (minor units)
  NCAI: '003', // Register(2) + Cashier(5)
  NS: '004', // Sequence Number
  NCAR: '007', // Card Number (masked)
  STAN: '008', // System Trace Audit Number
  NA: '009', // Authorization Number
  DP: '010', // Print Data (Receipt)
  DE: '012', // Currency Code
  CR: '013', // Response Code
  DV: '014', // Card Expiry (YYMM)
  SH: '015', // Entry Mode
  DT: '016', // Transaction Date (DDMMYYYY)
  HT: '017', // Transaction Time (HHMMSS)
  NC: '018', // Cardholder Name
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
 * Message Types
 */
export const MESSAGE_TYPES = {
  PAYMENT_REQUEST: '001',
  PAYMENT_RESPONSE: '101',
  CONFIRMATION_REQUEST: '002',
  CONFIRMATION_RESPONSE: '102',
} as const;

/**
 * Currency Codes
 */
export const CURRENCY = {
  MAD: '504',
} as const;
