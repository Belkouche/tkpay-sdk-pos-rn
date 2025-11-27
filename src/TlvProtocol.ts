/**
 * TLV Protocol implementation for NAPS Pay M2M
 *
 * Tag-Length-Value format:
 * - TAG: 3 digits
 * - LENGTH: 3 digits
 * - VALUE: variable length
 *
 * Example: 001003001 = Tag 001, Length 003, Value "001"
 */

import {
  TLV_TAGS,
  RECEIPT_TAGS,
  MESSAGE_TYPES,
  CURRENCY,
  Alignment,
  ReceiptType,
  type Receipt,
  type ReceiptLine,
} from './types';

/**
 * Build TLV field
 */
export function buildField(tag: string, value: string): string {
  const length = value.length.toString().padStart(3, '0');
  return `${tag}${length}${value}`;
}

/**
 * Get current date in DDMMYYYY format
 */
function getCurrentDate(): string {
  const now = new Date();
  const day = now.getDate().toString().padStart(2, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const year = now.getFullYear().toString();
  return `${day}${month}${year}`;
}

/**
 * Get current time in HHMMSS format
 */
function getCurrentTime(): string {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  return `${hours}${minutes}${seconds}`;
}

/**
 * Build payment request TLV
 */
export function buildPaymentRequest(
  amount: number,
  ncai: string,
  sequence: string
): string {
  const amountMinor = Math.round(amount * 100).toString();

  return (
    buildField(TLV_TAGS.TM, MESSAGE_TYPES.PAYMENT_REQUEST) +
    buildField(TLV_TAGS.MT, amountMinor) +
    buildField(TLV_TAGS.NCAI, ncai) +
    buildField(TLV_TAGS.NS, sequence) +
    buildField(TLV_TAGS.DE, CURRENCY.MAD) +
    buildField(TLV_TAGS.DT, getCurrentDate()) +
    buildField(TLV_TAGS.HT, getCurrentTime())
  );
}

/**
 * Build confirmation request TLV
 */
export function buildConfirmationRequest(
  stan: string,
  ncai: string,
  sequence: string
): string {
  return (
    buildField(TLV_TAGS.TM, MESSAGE_TYPES.CONFIRMATION_REQUEST) +
    buildField(TLV_TAGS.STAN, stan) +
    buildField(TLV_TAGS.NCAI, ncai) +
    buildField(TLV_TAGS.NS, sequence) +
    buildField(TLV_TAGS.DT, getCurrentDate()) +
    buildField(TLV_TAGS.HT, getCurrentTime())
  );
}

/**
 * Mask card number to show only first 6 and last 4 digits
 * Example: 5167940123453315 -> 516794******3315
 */
export function maskCardNumber(cardNumber: string): string {
  if (!cardNumber || cardNumber.length < 10) {
    return cardNumber;
  }

  const first6 = cardNumber.substring(0, 6);
  const last4 = cardNumber.substring(cardNumber.length - 4);
  const masked = '*'.repeat(cardNumber.length - 10);

  return `${first6}${masked}${last4}`;
}

/**
 * Mask any 16-digit card numbers in text
 */
export function maskCardNumbersInText(text: string): string {
  return text.replace(/\b\d{16}\b/g, (match) => maskCardNumber(match));
}

/**
 * Parse TLV string into fields map
 */
export function parseTlv(tlvString: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let index = 0;

  while (index < tlvString.length) {
    // Need at least 6 chars for tag + length
    if (index + 6 > tlvString.length) break;

    const tag = tlvString.substring(index, index + 3);
    const lengthStr = tlvString.substring(index + 3, index + 6);

    // Validate length is numeric
    if (!/^\d+$/.test(lengthStr)) break;

    const length = parseInt(lengthStr, 10);

    // Check if we have enough data for the value
    if (index + 6 + length > tlvString.length) break;

    let value = tlvString.substring(index + 6, index + 6 + length);

    // SECURITY: Immediately mask PAN in tag 007 (NCAR)
    if (tag === TLV_TAGS.NCAR) {
      value = maskCardNumber(value);
    }

    fields[tag] = value;
    index += 6 + length;
  }

  return fields;
}

/**
 * Parse receipt data from DP tag value
 */
export function parseReceipt(dpValue: string, type: ReceiptType): Receipt {
  const lines: ReceiptLine[] = [];
  let index = 0;
  let lineNumber = '';
  let format = 'S';
  let alignment = 'G';
  let content = '';

  while (index < dpValue.length) {
    if (index + 6 > dpValue.length) break;

    const tag = dpValue.substring(index, index + 3);
    const lengthStr = dpValue.substring(index + 3, index + 6);

    if (!/^\d+$/.test(lengthStr)) break;

    const length = parseInt(lengthStr, 10);

    if (index + 6 + length > dpValue.length) break;

    const value = dpValue.substring(index + 6, index + 6 + length);

    switch (tag) {
      case RECEIPT_TAGS.LINE_NUMBER:
        // New line starting - save previous if exists
        if (lineNumber && content) {
          lines.push(createReceiptLine(lineNumber, content, format, alignment));
        }
        lineNumber = value;
        format = 'S';
        alignment = 'G';
        content = '';
        break;
      case RECEIPT_TAGS.FORMAT:
        format = value;
        break;
      case RECEIPT_TAGS.ALIGNMENT:
        alignment = value;
        break;
      case RECEIPT_TAGS.CONTENT:
        content = value;
        break;
    }

    index += 6 + length;
  }

  // Don't forget the last line
  if (lineNumber && content) {
    lines.push(createReceiptLine(lineNumber, content, format, alignment));
  }

  // Apply TKPAY branding
  const brandedLines = applyBranding(lines);

  // Mask any card numbers in receipt
  const maskedLines = brandedLines.map((line) => ({
    ...line,
    text: maskCardNumbersInText(line.text),
  }));

  return { type, lines: maskedLines };
}

/**
 * Create receipt line from parsed data
 */
function createReceiptLine(
  lineNumber: string,
  content: string,
  format: string,
  alignmentCode: string
): ReceiptLine {
  const bold = format === 'G'; // G = Gras (Bold)

  let alignment: Alignment;
  switch (alignmentCode) {
    case 'C':
      alignment = Alignment.CENTER;
      break;
    case 'D':
      alignment = Alignment.RIGHT; // Droite
      break;
    case 'G':
    default:
      alignment = Alignment.LEFT; // Gauche
      break;
  }

  return { lineNumber, text: content, bold, alignment };
}

/**
 * Apply TKPAY branding to receipt
 */
function applyBranding(lines: ReceiptLine[]): ReceiptLine[] {
  const result: ReceiptLine[] = [];
  let brandingApplied = false;

  for (const line of lines) {
    if (
      !brandingApplied &&
      line.text.toLowerCase().includes('naps') &&
      line.alignment === Alignment.CENTER
    ) {
      // Replace with TKPAY header
      result.push({
        lineNumber: line.lineNumber,
        text: 'TKPAY',
        bold: true,
        alignment: Alignment.CENTER,
      });

      // Add "Powered by NAPS" below
      const nextLineNum = (parseInt(line.lineNumber, 10) + 1)
        .toString()
        .padStart(2, '0');
      result.push({
        lineNumber: nextLineNum,
        text: 'Powered by NAPS',
        bold: false,
        alignment: Alignment.CENTER,
      });

      brandingApplied = true;
    } else {
      result.push(line);
    }
  }

  return result;
}

/**
 * Format receipt as plain text
 */
export function receiptToPlainText(receipt: Receipt, width: number = 40): string {
  const lines: string[] = [];

  for (const line of receipt.lines) {
    let text = line.text;

    switch (line.alignment) {
      case Alignment.CENTER:
        const padding = Math.max(0, Math.floor((width - text.length) / 2));
        text = ' '.repeat(padding) + text;
        break;
      case Alignment.RIGHT:
        const rightPadding = Math.max(0, width - text.length);
        text = ' '.repeat(rightPadding) + text;
        break;
      case Alignment.LEFT:
      default:
        // No padding needed
        break;
    }

    lines.push(text);
  }

  return lines.join('\n');
}

/**
 * Get tag name for debugging
 */
export function getTagName(tag: string): string {
  switch (tag) {
    case TLV_TAGS.TM:
      return 'Message Type';
    case TLV_TAGS.MT:
      return 'Amount';
    case TLV_TAGS.NCAI:
      return 'NCAI';
    case TLV_TAGS.NS:
      return 'Sequence';
    case TLV_TAGS.NCAR:
      return 'Card Number';
    case TLV_TAGS.STAN:
      return 'STAN';
    case TLV_TAGS.NA:
      return 'Auth Number';
    case TLV_TAGS.DP:
      return 'Receipt Data';
    case TLV_TAGS.DE:
      return 'Currency';
    case TLV_TAGS.CR:
      return 'Response Code';
    case TLV_TAGS.DV:
      return 'Card Expiry';
    case TLV_TAGS.SH:
      return 'Entry Mode';
    case TLV_TAGS.DT:
      return 'Date';
    case TLV_TAGS.HT:
      return 'Time';
    case TLV_TAGS.NC:
      return 'Cardholder Name';
    default:
      return `Unknown Tag ${tag}`;
  }
}
