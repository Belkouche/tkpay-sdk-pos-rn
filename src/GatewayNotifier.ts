/**
 * Gateway Notifier for TKPay
 *
 * Sends transaction notifications to TKPay backend for reporting
 */

import { type PaymentRequest, type PaymentResult } from './types';

/** SDK version */
const SDK_VERSION = '1.0.0';

/** Gateway URL (static, not configurable) */
const GATEWAY_URL = 'https://api.tkpay.ma';

/** Gateway endpoint for transaction notifications */
const NOTIFICATION_ENDPOINT = '/v1/transactions/notify';

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT = 10000;

/**
 * Transaction notification payload
 */
interface TransactionNotification {
  terminal_host: string;
  amount: number;
  currency: string;
  response_code: string;
  stan?: string;
  auth_number?: string;
  masked_card_number?: string;
  card_expiry?: string;
  entry_mode?: string;
  cardholder_name?: string;
  ncai?: string;
  register_id: string;
  cashier_id: string;
  sequence?: string;
  transaction_date?: string;
  transaction_time?: string;
  success: boolean;
  error_message?: string;
  sdk_version: string;
  platform: string;
  timestamp: string;
}

/**
 * Determine the platform
 * Uses global navigator object available in React Native
 */
function getPlatform(): string {
  try {
    // Check navigator.product which is 'ReactNative' in RN environment
    if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
      // Use userAgent to determine iOS vs Android
      const userAgent = navigator.userAgent || '';
      if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
        return 'react-native-ios';
      }
      return 'react-native-android';
    }
    return 'react-native';
  } catch {
    return 'react-native';
  }
}

/**
 * Send transaction notification to TKPay gateway
 * This is fire-and-forget - errors are logged but don't affect the payment flow
 * Runs in a completely isolated async context using setTimeout
 */
export function notifyTransaction(
  terminalHost: string,
  request: PaymentRequest,
  result: PaymentResult
): void {
  // Use setTimeout to ensure this runs in a separate event loop tick
  // This guarantees it never blocks the caller
  setTimeout(() => {
    try {
      const notification: TransactionNotification = {
        terminal_host: terminalHost,
        amount: request.amount,
        currency: 'MAD',
        response_code: result.responseCode,
        stan: result.stan,
        auth_number: result.authNumber,
        masked_card_number: result.maskedCardNumber,
        card_expiry: result.cardExpiry,
        entry_mode: result.entryMode,
        cardholder_name: result.cardholderName,
        ncai: result.ncai ?? request.registerId + request.cashierId,
        register_id: request.registerId,
        cashier_id: request.cashierId,
        sequence: result.sequence ?? request.sequence,
        transaction_date: result.transactionDate,
        transaction_time: result.transactionTime,
        success: result.success,
        error_message: result.error,
        sdk_version: SDK_VERSION,
        platform: getPlatform(),
        timestamp: new Date().toISOString(),
      };

      // Send notification asynchronously (fire-and-forget)
      sendNotification(notification).catch(() => {
        // Silently ignore - never affect payment flow
        if (__DEV__) {
          console.log('[TKPayNaps] Background notification failed');
        }
      });
    } catch {
      // Silently ignore any errors during notification creation
      if (__DEV__) {
        console.log('[TKPayNaps] Failed to create notification');
      }
    }
  }, 0);
}

// Declare __DEV__ for TypeScript
declare const __DEV__: boolean | undefined;

/**
 * Send the notification to the gateway
 * This method is completely isolated and will never throw or block the caller
 */
async function sendNotification(
  notification: TransactionNotification
): Promise<void> {
  const url = `${GATEWAY_URL}${NOTIFICATION_ENDPOINT}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `TKPayNaps-ReactNative/${SDK_VERSION}`,
      },
      body: JSON.stringify(notification),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (__DEV__) {
      if (response.ok) {
        console.log('[TKPayNaps] Transaction notification sent successfully');
      } else {
        console.log('[TKPayNaps] Gateway returned status:', response.status);
      }
    }
  } catch {
    clearTimeout(timeoutId);
    // Silently fail - never affect payment flow
  }
}
