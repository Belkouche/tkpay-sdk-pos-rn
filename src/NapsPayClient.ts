/**
 * NAPS Pay Client for React Native
 *
 * Main entry point for NAPS Pay terminal integration
 */

import {
  type NapsConfig,
  type PaymentRequest,
  type PaymentResult,
  TLV_TAGS,
  ReceiptType,
  NapsError,
  ErrorCode,
} from './types';
import { notifyTransaction } from './GatewayNotifier';
import {
  buildPaymentRequest,
  buildConfirmationRequest,
  parseTlv,
  parseReceipt,
  maskCardNumber,
} from './TlvProtocol';

// Declare React Native types for build time
declare const require: (module: string) => any;

// Lazy load React Native to avoid build-time dependency
let NapsPayNative: any = null;

function getNativeModule(): any {
  if (NapsPayNative === null) {
    try {
      const { NativeModules, Platform } = require('react-native');

      const LINKING_ERROR =
        `The package 'react-native-tkpay-naps' doesn't seem to be linked. Make sure: \n\n` +
        (Platform.OS === 'ios' ? "- You have run 'pod install'\n" : '') +
        '- You rebuilt the app after installing the package\n' +
        '- You are not using Expo Go (custom native code required)\n';

      NapsPayNative = NativeModules.TkpayNaps
        ? NativeModules.TkpayNaps
        : new Proxy(
            {},
            {
              get() {
                throw new Error(LINKING_ERROR);
              },
            }
          );
    } catch (e) {
      throw new Error('react-native is not available');
    }
  }
  return NapsPayNative;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<Omit<NapsConfig, 'host'>> = {
  port: 4444,
  timeout: 120000,
  confirmationTimeout: 40000,
};

/**
 * NAPS Pay Client
 */
export class NapsPayClient {
  private config: Required<NapsConfig>;
  private sequenceCounter: number = 1;

  constructor(config: NapsConfig) {
    const minTimeout = 1000; // 1 second
    let timeout = config.timeout ?? DEFAULT_CONFIG.timeout;
    let confirmationTimeout =
      config.confirmationTimeout ?? DEFAULT_CONFIG.confirmationTimeout;

    if (timeout < minTimeout) {
      console.warn(
        `[TKPAY] Warning: NapsConfig.timeout (${timeout}ms) is too low. Using minimum value: ${minTimeout}ms`
      );
      timeout = minTimeout;
    }
    if (confirmationTimeout < minTimeout) {
      console.warn(
        `[TKPAY] Warning: NapsConfig.confirmationTimeout (${confirmationTimeout}ms) is too low. Using minimum value: ${minTimeout}ms`
      );
      confirmationTimeout = minTimeout;
    }

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      timeout,
      confirmationTimeout,
    };
  }

  /**
   * Process a payment transaction
   *
   * This performs the complete two-phase payment flow:
   * 1. Send payment request → Customer taps card
   * 2. Send confirmation → Transaction complete
   */
  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    // Validate request
    this.validateRequest(request);

    const ncai = request.registerId + request.cashierId;
    const sequence = request.sequence || this.generateSequence();

    try {
      // Build payment request TLV
      const paymentTlv = buildPaymentRequest(request.amount, ncai, sequence);

      // Phase 1: Send payment request
      const paymentResponse = await getNativeModule().sendPaymentRequest(
        this.config.host,
        this.config.port,
        paymentTlv,
        this.config.timeout
      );

      const paymentFields = parseTlv(paymentResponse);

      // Check response code
      const responseCode = paymentFields[TLV_TAGS.CR];
      if (!responseCode) {
        throw NapsError.invalidResponse('Missing response code');
      }

      if (responseCode !== '000') {
        const result = this.buildFailedResult(responseCode, paymentFields);
        // Send notification to gateway
        notifyTransaction(this.config.host, request, result);
        return result;
      }

      // Get STAN for confirmation
      const stan = paymentFields[TLV_TAGS.STAN];
      if (!stan) {
        throw NapsError.invalidResponse('Missing STAN');
      }

      // Build confirmation TLV
      const confirmTlv = buildConfirmationRequest(stan, ncai, sequence);

      // Phase 2: Send confirmation (on same connection)
      const confirmResponse = await getNativeModule().sendConfirmation(
        confirmTlv,
        this.config.confirmationTimeout
      );

      const confirmFields = parseTlv(confirmResponse);

      // Build successful result
      const result = this.buildSuccessResult(confirmFields, request.amount);

      // Send notification to gateway
      notifyTransaction(this.config.host, request, result);

      return result;
    } catch (error: unknown) {
      if (error instanceof NapsError) {
        throw error;
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('timeout')) {
        throw NapsError.timeout();
      }
      if (
        errorMessage.includes('connect') ||
        errorMessage.includes('connection')
      ) {
        throw NapsError.connectionFailed(errorMessage);
      }

      throw new NapsError(ErrorCode.UNKNOWN_ERROR, errorMessage);
    }
  }

  /**
   * Test connection to terminal
   */
  async testConnection(): Promise<boolean> {
    try {
      return await getNativeModule().testConnection(
        this.config.host,
        this.config.port,
        5000 // 5 second timeout for test
      );
    } catch {
      return false;
    }
  }

  /**
   * Validate payment request
   */
  private validateRequest(request: PaymentRequest): void {
    if (request.amount <= 0) {
      throw new NapsError(ErrorCode.INVALID_RESPONSE, 'Amount must be positive');
    }
    if (request.registerId.length !== 2) {
      throw new NapsError(
        ErrorCode.INVALID_RESPONSE,
        'Register ID must be 2 digits'
      );
    }
    if (request.cashierId.length !== 5) {
      throw new NapsError(
        ErrorCode.INVALID_RESPONSE,
        'Cashier ID must be 5 digits'
      );
    }
  }

  /**
   * Generate sequence number (6 digits)
   */
  private generateSequence(): string {
    const seq = this.sequenceCounter++;
    if (this.sequenceCounter > 999999) {
      this.sequenceCounter = 1;
    }
    return seq.toString().padStart(6, '0');
  }

  /**
   * Build successful payment result
   */
  private buildSuccessResult(
    fields: Record<string, string>,
    amount: number
  ): PaymentResult {
    // Parse receipts
    const dpValue = fields[TLV_TAGS.DP];
    const merchantReceipt = dpValue
      ? parseReceipt(dpValue, ReceiptType.MERCHANT)
      : undefined;
    const customerReceipt = dpValue
      ? parseReceipt(dpValue, ReceiptType.CUSTOMER)
      : undefined;

    return {
      success: true,
      responseCode: fields[TLV_TAGS.CR] || '000',
      stan: fields[TLV_TAGS.STAN],
      maskedCardNumber: fields[TLV_TAGS.NCAR],
      cardExpiry: fields[TLV_TAGS.DV],
      cardholderName: fields[TLV_TAGS.NC],
      entryMode: fields[TLV_TAGS.SH],
      authNumber: fields[TLV_TAGS.NA],
      ncai: fields[TLV_TAGS.NCAI],
      sequence: fields[TLV_TAGS.NS],
      transactionDate: fields[TLV_TAGS.DT],
      transactionTime: fields[TLV_TAGS.HT],
      merchantReceipt,
      customerReceipt,
    };
  }

  /**
   * Build failed payment result
   */
  private buildFailedResult(
    responseCode: string,
    fields: Record<string, string>
  ): PaymentResult {
    let errorMessage: string;
    switch (responseCode) {
      case '909':
        errorMessage = 'Terminal or server is down';
        break;
      case '302':
        errorMessage = 'Transaction not found';
        break;
      case '482':
        errorMessage = 'Transaction already cancelled';
        break;
      case '480':
        errorMessage = 'Transaction cancelled';
        break;
      default:
        errorMessage = `Payment declined with code: ${responseCode}`;
    }

    return {
      success: false,
      responseCode,
      stan: fields[TLV_TAGS.STAN],
      error: errorMessage,
    };
  }
}

/**
 * Utility function to mask card numbers
 */
export { maskCardNumber };
