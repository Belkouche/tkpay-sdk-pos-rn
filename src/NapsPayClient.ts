/**
 * NAPS Pay Client for React Native
 *
 * Main entry point for NAPS Pay terminal integration
 */

import {
  type NapsConfig,
  type PaymentRequest,
  type PaymentResult,
  type SettlementResult,
  type CancellationResult,
  type NetworkTestResult,
  type DuplicateReceiptResult,
  type ResetResult,
  type ReferencingResult,
  TLV_TAGS,
  MESSAGE_TYPES,
  ReceiptType,
  NapsError,
  ErrorCode,
} from './types';
import { notifyTransaction } from './GatewayNotifier';
import {
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
  maskCardNumber,
  enhanceMerchantReceipt,
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
   * Force end-of-day settlement (telecollecte) — TM=010
   *
   * Sends batch totals to the NAPS server. The terminal must be idle
   * ("Attente Caisse") and referencing must have run at least once.
   *
   * @param registerId Register ID (2 digits)
   * @param cashierId Cashier ID (5 digits)
   */
  async settlement(registerId: string, cashierId: string): Promise<SettlementResult> {
    const ncai = registerId + cashierId;
    const settlementTlv = buildSettlementRequest(ncai);

    try {
      const response = await getNativeModule().sendPaymentRequest(
        this.config.host,
        this.config.port,
        settlementTlv,
        this.config.timeout
      );

      const fields = parseTlv(response);
      const responseCode = fields[TLV_TAGS.CR] ?? '';

      return {
        success: responseCode === '000',
        responseCode,
        date: fields[TLV_TAGS.DA],
        time: fields[TLV_TAGS.HE],
        error: responseCode !== '000' ? `Settlement failed with code: ${responseCode}` : undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, responseCode: '', error: message };
    }
  }

  /**
   * Test connection to terminal (TCP-level only)
   */
  async testConnection(): Promise<boolean> {
    try {
      return await getNativeModule().testConnection(
        this.config.host,
        this.config.port,
        5000
      );
    } catch {
      return false;
    }
  }

  /**
   * Send a network test message to the terminal (TM=009)
   *
   * Unlike testConnection() which only opens a TCP socket,
   * this sends the actual NAPS M2M network test message and
   * verifies the terminal responds RC=000.
   *
   * @param registerId Register ID (2 digits)
   * @param cashierId  Cashier ID (5 digits)
   */
  async networkTest(
    registerId: string,
    cashierId: string
  ): Promise<NetworkTestResult> {
    const ncai = registerId + cashierId;
    const tlv = buildNetworkTestRequest(ncai);
    const start = Date.now();

    try {
      const raw = await getNativeModule().sendPaymentRequest(
        this.config.host,
        this.config.port,
        tlv,
        10000 // short timeout — terminal should answer immediately
      );

      const fields = parseTlv(raw);
      const responseCode = fields[TLV_TAGS.CR] ?? '';
      const rttMs = Date.now() - start;

      return {
        success: responseCode === '000',
        responseCode,
        rttMs,
        error: responseCode !== '000'
          ? `Network test failed with code: ${responseCode}`
          : undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, responseCode: '', error: message };
    }
  }

  /**
   * Cancel (void) a previous transaction (TM=003)
   *
   * Can only cancel the last approved transaction while the terminal
   * is still on the same session. Send the STAN returned by processPayment().
   *
   * @param stan       STAN of the transaction to cancel
   * @param registerId Register ID (2 digits)
   * @param cashierId  Cashier ID (5 digits)
   * @param sequence   Sequence number of the original transaction
   */
  /**
   * Cancel (void) a previous transaction (TM=003)
   *
   * NapsPay v5.4.4+ requires [amountCentimes] (TAG 002) in the frame and
   * may respond with MT=104 (correction) in addition to MT=103. Both are success.
   *
   * @param stan       STAN of the transaction to cancel
   * @param registerId Register ID (2 digits)
   * @param cashierId  Cashier ID (5 digits)
   * @param sequence   Sequence number of the original transaction
   * @param amountCentimes  Original amount in centimes (required for v5.4.4+)
   */
  async cancelPayment(
    stan: string,
    registerId: string,
    cashierId: string,
    sequence: string,
    amountCentimes?: number
  ): Promise<CancellationResult> {
    const ncai = registerId + cashierId;
    const tlv = buildCancellationRequest(stan, ncai, sequence, amountCentimes);

    try {
      const raw = await getNativeModule().sendPaymentRequest(
        this.config.host,
        this.config.port,
        tlv,
        this.config.timeout
      );

      const fields = parseTlv(raw);
      const responseCode = fields[TLV_TAGS.CR] ?? '';
      const mt = fields[TLV_TAGS.TM] ?? '';
      const success =
        (mt === MESSAGE_TYPES.CANCELLATION_RESPONSE ||
          mt === MESSAGE_TYPES.CANCELLATION_CORRECTION) &&
        responseCode === '000';

      return {
        success,
        responseCode,
        stan: fields[TLV_TAGS.STAN],
        error: success
          ? undefined
          : `Cancellation failed with code: ${responseCode}`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, responseCode: '', error: message };
    }
  }

  /**
   * Request a duplicate receipt from the terminal (TM=008)
   *
   * Reprints the last transaction receipt. Pass stan to reprint a specific
   * transaction; omit to reprint the last one.
   *
   * @param registerId Register ID (2 digits)
   * @param cashierId  Cashier ID (5 digits)
   * @param stan       Optional STAN of the transaction to reprint
   */
  async printDuplicate(
    registerId: string,
    cashierId: string,
    stan?: string
  ): Promise<DuplicateReceiptResult> {
    const ncai = registerId + cashierId;
    const tlv = buildDuplicateRequest(ncai, stan);

    try {
      const raw = await getNativeModule().sendPaymentRequest(
        this.config.host,
        this.config.port,
        tlv,
        this.config.timeout
      );

      const fields = parseTlv(raw);
      const responseCode = fields[TLV_TAGS.CR] ?? '';
      const dpValue = fields[TLV_TAGS.DP];
      const merchantReceipt = dpValue
        ? parseReceipt(dpValue, ReceiptType.MERCHANT)
        : undefined;

      return {
        success: responseCode === '000',
        responseCode,
        merchantReceipt,
        error: responseCode !== '000'
          ? `Duplicate receipt failed with code: ${responseCode}`
          : undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, responseCode: '', error: message };
    }
  }

  /**
   * Reset the terminal PinPAD (TM=012)
   *
   * Sends the terminal back to idle ("Attente Caisse") state.
   * Use if the terminal is stuck in card-waiting mode.
   *
   * @param registerId Register ID (2 digits)
   * @param cashierId  Cashier ID (5 digits)
   */
  async resetPinPad(
    registerId: string,
    cashierId: string
  ): Promise<ResetResult> {
    const ncai = registerId + cashierId;
    const tlv = buildResetRequest(ncai);

    try {
      const raw = await getNativeModule().sendPaymentRequest(
        this.config.host,
        this.config.port,
        tlv,
        10000
      );

      const fields = parseTlv(raw);
      const responseCode = fields[TLV_TAGS.CR] ?? '';

      return {
        success: responseCode === '000',
        responseCode,
        error: responseCode !== '000'
          ? `Reset failed with code: ${responseCode}`
          : undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, responseCode: '', error: message };
    }
  }

  /**
   * Run terminal referencing / configuration sync (TM=013)
   *
   * Must be called at least once before the first payment to download
   * merchant config from the NAPS server. Also useful for troubleshooting
   * terminal configuration issues.
   *
   * @param registerId Register ID (2 digits)
   * @param cashierId  Cashier ID (5 digits)
   */
  async referencing(
    registerId: string,
    cashierId: string
  ): Promise<ReferencingResult> {
    const ncai = registerId + cashierId;
    const tlv = buildReferencingRequest(ncai);

    try {
      const raw = await getNativeModule().sendPaymentRequest(
        this.config.host,
        this.config.port,
        tlv,
        this.config.timeout
      );

      const fields = parseTlv(raw);
      const responseCode = fields[TLV_TAGS.CR] ?? '';
      const dpValue = fields[TLV_TAGS.DP];
      const receipt = dpValue
        ? parseReceipt(dpValue, ReceiptType.MERCHANT)
        : undefined;

      return {
        success: responseCode === '000',
        responseCode,
        receipt,
        error: responseCode !== '000'
          ? `Referencing failed with code: ${responseCode}`
          : undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, responseCode: '', error: message };
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
    let merchantReceipt = dpValue
      ? parseReceipt(dpValue, ReceiptType.MERCHANT)
      : undefined;
    let customerReceipt = dpValue
      ? parseReceipt(dpValue, ReceiptType.CUSTOMER)
      : undefined;

    const stan = fields[TLV_TAGS.STAN] || '';
    const ncai = fields[TLV_TAGS.NCAI] || '';
    const sequence = fields[TLV_TAGS.NS] || '';

    // Enhance merchant receipt with STAN, NCAI, and Sequence Number
    if (merchantReceipt && stan) {
      merchantReceipt = enhanceMerchantReceipt(merchantReceipt, stan, ncai, sequence);
    }

    return {
      success: true,
      responseCode: fields[TLV_TAGS.CR] || '000',
      stan,
      maskedCardNumber: fields[TLV_TAGS.NCAR],
      cardExpiry: fields[TLV_TAGS.DAEX],
      cardholderName: fields[TLV_TAGS.NPRT],
      entryMode: fields[TLV_TAGS.EM],
      authNumber: fields[TLV_TAGS.NA],
      ncai,
      sequence,
      transactionDate: fields[TLV_TAGS.DATR],
      transactionTime: fields[TLV_TAGS.HETR],
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
