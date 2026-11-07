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
  TIDE,
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
 * CR (013) response codes considered a successful approval.
 * 000 Approved · 001 Approved with identification · 003 Approved (VIP) ·
 * 007 Approved, microchip update required.
 */
export const APPROVED_CODES = new Set<string>(['000', '001', '003', '007']);

/**
 * Whether a CR (013) response code represents an approval.
 */
export function isApproved(cr?: string): boolean {
  return cr !== undefined && APPROVED_CODES.has(cr);
}

/**
 * CR (013) response code descriptions from the NAPS M2M v2 spec §6.
 */
export const RESPONSE_CODES: Record<string, string> = {
  '000': 'Approved',
  '001': 'Approved with identification',
  '003': 'Approved (VIP)',
  '007': 'Approved, microchip update required',
  '100': 'Do not honour',
  '101': 'Card expired',
  '102': 'Fraud suspected',
  '104': 'Restricted card use',
  '106': 'Allowed PIN tries exceeded',
  '107': 'Refer to card issuer',
  '108': 'Refer to issuer special conditions',
  '109': 'Invalid merchant',
  '110': 'Invalid amount',
  '111': 'Invalid card number',
  '112': 'PIN information required',
  '114': 'No account of requested type',
  '115': 'Requested function not supported',
  '116': 'Insufficient funds',
  '117': 'Incorrect PIN',
  '118': 'Card not registered',
  '119': 'Transaction not permitted to cardholder',
  '120': 'Transaction not permitted at terminal',
  '121': 'Withdrawal limit exceeded',
  '122': 'Security violation',
  '123': 'Withdrawal frequency exceeded',
  '125': 'Card not in service',
  '126': 'Invalid PIN format',
  '127': 'PIN length error',
  '128': 'PIN key sync error',
  '129': 'Card counterfeiting suspected',
  '180': 'Credit account does not exist',
  '181': 'Cheque account does not exist',
  '182': 'Savings account does not exist',
  '183': 'Invalid CVV',
  '184': 'Invalid date',
  '200': 'Do not honour — capture card',
  '201': 'Card expired — capture card',
  '202': 'Fraud suspected — capture card',
  '204': 'Restricted card — capture card',
  '205': 'Security service — capture card',
  '206': 'PIN tries exceeded — capture card',
  '207': 'Special conditions — capture card',
  '208': 'Lost card — capture card',
  '209': 'Stolen card — capture card',
  '210': 'Counterfeiting suspected — capture card',
  '265': 'Please use the chip',
  '280': 'Alternative amount cancelled',
  '281': 'PIN verification failed',
  '299': 'Capture card',
  '300': 'Processing completed',
  '301': 'Not supported by recipient',
  '302': 'Record not found on file',
  '303': 'Duplicate record, old record replaced',
  '304': 'Field edit error',
  '305': 'File locked',
  '306': 'Processing failure',
  '307': 'Format error',
  '308': 'Duplicate processing, new record rejected',
  '309': 'File unknown',
  '381': 'Record not found. Account unsettled. Withdrawal not processed',
  '382': 'Balance record deleted',
  '383': 'Balance updated',
  '385': 'Balance enquiry',
  '400': 'Reversal approved',
  '480': 'Reversal accepted',
  '481': 'Reversal amount incorrect',
  '482': 'Transaction already cancelled',
  '501': 'Reversal amount incorrect',
  '500': 'Reconciliation successful',
  '503': 'Totals not available',
  '581': 'Reconciliation already done',
  '582': 'Reconciliation procedure not available',
  '700': 'Top-ups fully reserved',
  '701': 'Top-ups partially reserved',
  '702': 'Top-ups not reserved',
  '750': 'Message or ECR request not authorised by centre',
  '800': 'Cut-off in progress',
  '880': 'Connection not accepted',
  '888': 'End of cut-off',
  '902': 'Invalid transaction',
  '908': 'Transaction recipient not referenced for routing',
  '909': 'System failure',
  '911': 'Issuer did not respond in time',
  '912': 'Card issuer unavailable',
  '992': 'Issuer not found',
  '993': 'PIN verification impossible',
  '994': 'Transaction processing error',
  '995': 'Server processing error',
};

/**
 * Human-readable description of a CR (013) response code,
 * or a fallback string when the code is unknown (§6).
 */
export function describeResponseCode(cr?: string): string {
  if (cr !== undefined && RESPONSE_CODES[cr] !== undefined) {
    return RESPONSE_CODES[cr];
  }
  return `Unknown response code: ${cr ?? '(none)'}`;
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
 * Sends the current date/time in both DA/HE (local clock) and DATR/HETR (transaction).
 */
export function buildPaymentRequest(
  amount: number,
  ncai: string,
  sequence: string
): string {
  const amountMinor = Math.round(amount * 100).toString();
  const date = getCurrentDate();
  const time = getCurrentTime();

  return (
    buildField(TLV_TAGS.TM, MESSAGE_TYPES.PAYMENT_REQUEST) +
    buildField(TLV_TAGS.MT, amountMinor) +
    buildField(TLV_TAGS.NCAI, ncai) +
    buildField(TLV_TAGS.NS, sequence) +
    buildField(TLV_TAGS.DE, CURRENCY.MAD) +
    buildField(TLV_TAGS.DA, date) +
    buildField(TLV_TAGS.HE, time) +
    buildField(TLV_TAGS.DATR, date) +
    buildField(TLV_TAGS.HETR, time)
  );
}

/**
 * Optional fields carried by an enriched Payment Confirmation (TM=002) per v2 §4.2.
 * Thread these from the Phase-1 Payment Response (TM=101) so the terminal can
 * reinforce its coherence checks against the approved transaction.
 */
export interface ConfirmationOptions {
  /** Amount in centimes (12-digit MT / tag 002). Adds MT + DE when provided. */
  amountCentimes?: number;
  /** Masked PAN from the approved response (NCAR / tag 007). */
  ncar?: string;
  /** Card expiry YYMM from the approved response (DAEX / tag 017). */
  daex?: string;
  /** Currency code for DE / tag 012 (default "504" = MAD). */
  currency?: string;
}

/**
 * Build confirmation request TLV (TM=002).
 *
 * v1 callers may pass only (stan, ncai, sequence). v2 callers pass `options`
 * to carry MT/DE, NCAR and DAEX echoed from the approved Payment Response.
 * Field order mirrors the reference SDK: TM, NCAI, NS, [MT, DE], STAN, [NCAR], [DAEX], DA, HE.
 */
export function buildConfirmationRequest(
  stan: string,
  ncai: string,
  sequence: string,
  options?: ConfirmationOptions
): string {
  const currency = options?.currency ?? CURRENCY.MAD;

  let msg =
    buildField(TLV_TAGS.TM, MESSAGE_TYPES.CONFIRMATION_REQUEST) +
    buildField(TLV_TAGS.NCAI, ncai) +
    buildField(TLV_TAGS.NS, sequence);

  if (options?.amountCentimes !== undefined) {
    msg +=
      buildField(TLV_TAGS.MT, options.amountCentimes.toString()) +
      buildField(TLV_TAGS.DE, currency);
  }

  msg += buildField(TLV_TAGS.STAN, stan);

  if (options?.ncar) {
    msg += buildField(TLV_TAGS.NCAR, options.ncar);
  }
  if (options?.daex) {
    msg += buildField(TLV_TAGS.DAEX, options.daex);
  }

  msg += buildField(TLV_TAGS.DA, getCurrentDate()) + buildField(TLV_TAGS.HE, getCurrentTime());

  return msg;
}

/**
 * Build settlement request TLV (TM=010)
 */
export function buildSettlementRequest(ncai: string): string {
  return (
    buildField(TLV_TAGS.TM, MESSAGE_TYPES.SETTLEMENT_REQUEST) +
    buildField(TLV_TAGS.NCAI, ncai) +
    buildField(TLV_TAGS.DA, getCurrentDate()) +
    buildField(TLV_TAGS.HE, getCurrentTime())
  );
}

/**
 * Build cancellation request TLV (TM=003)
 *
 * NapsPay v5.4.4+ requires the original amount (TAG 002) in the frame.
 * Pass `amountCentimes` when targeting v5.4.4+.
 *
 * @param stan   STAN of the transaction to cancel
 * @param ncai   Register(2) + Cashier(5)
 * @param sequence  Original sequence number
 * @param amountCentimes  Original amount in centimes (required for v5.4.4+)
 */
export function buildCancellationRequest(
  stan: string,
  ncai: string,
  sequence: string,
  amountCentimes?: number
): string {
  let msg = buildField(TLV_TAGS.TM, MESSAGE_TYPES.CANCELLATION_REQUEST);
  if (amountCentimes !== undefined) {
    msg += buildField(TLV_TAGS.MT, amountCentimes.toString());
  }
  msg +=
    buildField(TLV_TAGS.STAN, stan) +
    buildField(TLV_TAGS.NCAI, ncai) +
    buildField(TLV_TAGS.NSA, sequence) +
    buildField(TLV_TAGS.DA, getCurrentDate()) +
    buildField(TLV_TAGS.HE, getCurrentTime());
  return msg;
}

/**
 * Build cancellation confirmation request TLV (TM=004)
 * Sent on the same connection after receiving MT=103 from TM=003.
 *
 * @param amount  Amount echoed from the MT=103 response (TAG 002, 12-digit) —
 *                required by NapsPay v5.4.4+
 */
export function buildCancellationConfirmation(
  stan: string,
  ncai: string,
  sequence: string,
  amount?: string
): string {
  let msg = buildField(TLV_TAGS.TM, MESSAGE_TYPES.CANCELLATION_CONFIRMATION_REQUEST);
  if (amount !== undefined) {
    msg += buildField(TLV_TAGS.MT, amount);
  }
  msg +=
    buildField(TLV_TAGS.STAN, stan) +
    buildField(TLV_TAGS.NCAI, ncai) +
    buildField(TLV_TAGS.NS, sequence) +
    buildField(TLV_TAGS.DA, getCurrentDate()) +
    buildField(TLV_TAGS.HE, getCurrentTime());
  return msg;
}

/**
 * Build network test request TLV (TM=009)
 */
export function buildNetworkTestRequest(ncai: string, sequence: string = '000001'): string {
  return (
    buildField(TLV_TAGS.TM, MESSAGE_TYPES.NETWORK_TEST_REQUEST) +
    buildField(TLV_TAGS.NCAI, ncai) +
    buildField(TLV_TAGS.NS, sequence) +
    buildField(TLV_TAGS.DA, getCurrentDate()) +
    buildField(TLV_TAGS.HE, getCurrentTime())
  );
}

/**
 * Build duplicate receipt request TLV (TM=008)
 * @param stan  STAN of the transaction to reprint (optional — terminal uses last if absent)
 * @param sequence  Sequence number (NS / TAG 004)
 */
export function buildDuplicateRequest(
  ncai: string,
  stan?: string,
  sequence: string = '000001'
): string {
  let tlv =
    buildField(TLV_TAGS.TM, MESSAGE_TYPES.DUPLICATE_REQUEST) +
    buildField(TLV_TAGS.NCAI, ncai) +
    buildField(TLV_TAGS.NS, sequence);
  if (stan) {
    tlv += buildField(TLV_TAGS.STAN, stan);
  }
  tlv +=
    buildField(TLV_TAGS.DA, getCurrentDate()) +
    buildField(TLV_TAGS.HE, getCurrentTime());
  return tlv;
}

/**
 * Build reset PinPAD request TLV (TM=012)
 */
export function buildResetRequest(ncai: string, sequence: string = '000001'): string {
  return (
    buildField(TLV_TAGS.TM, MESSAGE_TYPES.RESET_REQUEST) +
    buildField(TLV_TAGS.NCAI, ncai) +
    buildField(TLV_TAGS.NS, sequence) +
    buildField(TLV_TAGS.DA, getCurrentDate()) +
    buildField(TLV_TAGS.HE, getCurrentTime())
  );
}

/**
 * Build totals report request TLV (TM=010 — shares TM with settlement, carries NS)
 */
export function buildTotalsRequest(ncai: string, sequence: string = '000001'): string {
  return (
    buildField(TLV_TAGS.TM, MESSAGE_TYPES.TOTALS_REQUEST) +
    buildField(TLV_TAGS.NCAI, ncai) +
    buildField(TLV_TAGS.NS, sequence) +
    buildField(TLV_TAGS.DA, getCurrentDate()) +
    buildField(TLV_TAGS.HE, getCurrentTime())
  );
}

/**
 * Build referencing request TLV (TM=013)
 * @param tide  Parameter set to load (TAG 020): "01" merchant (default), "02" recharge
 */
export function buildReferencingRequest(
  ncai: string,
  sequence: string = '000001',
  tide: string = TIDE.MERCHANT
): string {
  return (
    buildField(TLV_TAGS.TM, MESSAGE_TYPES.REFERENCING_REQUEST) +
    buildField(TLV_TAGS.NCAI, ncai) +
    buildField(TLV_TAGS.NS, sequence) +
    buildField(TLV_TAGS.DA, getCurrentDate()) +
    buildField(TLV_TAGS.HE, getCurrentTime()) +
    buildField(TLV_TAGS.TIDE, tide)
  );
}

/**
 * Mask card number to show only first 6 and last 4 digits
 * Digits are counted, so spaces or dashes are kept in place.
 * Example: 5167940123453315 -> 516794******3315, 5167 9401 2345 3315 -> 5167 94** **** 3315
 */
export function maskCardNumber(cardNumber: string): string {
  if (!cardNumber) {
    return cardNumber;
  }

  const digitCount = cardNumber.replace(/\D/g, '').length;
  if (digitCount < 10) {
    return cardNumber;
  }

  let digitIndex = 0;
  return cardNumber.replace(/\d/g, (digit) => {
    const i = digitIndex++;
    return i < 6 || i >= digitCount - 4 ? digit : '*';
  });
}

/**
 * Card numbers in text: 13+ digits written together, in groups of 4
 * (4-4-4-4, 4-4-4-4-3, …) or as 4-6-5, separated by spaces or dashes.
 * Longer runs match too, so a card number followed by more digits is still masked.
 */
const CARD_NUMBER_IN_TEXT =
  /\b(?:\d{4}(?:[ -]\d{4}){2,}(?:[ -]\d{1,4})?|\d{4}[ -]\d{6}[ -]\d{4,5}|\d{13,})\b/g;

/**
 * Mask any card number (13-19 digits, optionally with spaces or dashes) in text.
 * Fails closed: a run of more than 19 digits is masked as well.
 */
export function maskCardNumbersInText(text: string): string {
  return text.replace(CARD_NUMBER_IN_TEXT, (match) =>
    match.replace(/\D/g, '').length >= 13 ? maskCardNumber(match) : match
  );
}

/**
 * Parse TLV string into fields map
 */
export function parseTlv(tlvString: string): Record<string, string> {
  const fields: Record<string, string> = {};

  // Values are length-delimited, so a '!' or '?' inside one (a DP block ends
  // with '?', receipt text may contain '!') is data. The end-of-message
  // terminator ('!' v2, '?' v1) only counts where a tag is expected; anything
  // after it is ignored. Both are accepted so the parser stays protocol-version
  // agnostic even if the native layer did not strip them.
  const data = tlvString;

  let index = 0;

  while (index < data.length) {
    if (data[index] === '!' || data[index] === '?') break;

    // Need at least 6 chars for tag + length
    if (index + 6 > data.length) break;

    const tag = data.substring(index, index + 3);
    const lengthStr = data.substring(index + 3, index + 6);

    // Both tag and length must be 3-digit numeric strings
    if (!/^\d{3}$/.test(tag) || !/^\d{3}$/.test(lengthStr)) break;

    const length = parseInt(lengthStr, 10);

    // Check if we have enough data for the value
    if (index + 6 + length > data.length) break;

    let value = data.substring(index + 6, index + 6 + length);

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
 *
 * Print lines are groups of sub-tags (030-033) separated by '*'; the last
 * group may end with '?' (spec §5). Values are length-delimited, so a '*'
 * inside a line (e.g. a masked PAN) is kept.
 */
export function parseReceipt(dpValue: string, type: ReceiptType): Receipt {
  const lines: ReceiptLine[] = [];
  let index = 0;
  let open = false;
  let lineNumber = '';
  let format = 'S';
  let alignment = 'G';
  let content = '';

  // Every line is kept as sent, even with empty text
  const flush = () => {
    if (open) {
      lines.push(createReceiptLine(lineNumber, content, format, alignment));
    }
    open = false;
    lineNumber = '';
    format = 'S';
    alignment = 'G';
    content = '';
  };

  while (index < dpValue.length) {
    // '*' separates print lines, '?' ends the block
    if (dpValue[index] === '*' || dpValue[index] === '?') {
      flush();
      index++;
      continue;
    }

    if (index + 6 > dpValue.length) break;

    const tag = dpValue.substring(index, index + 3);
    const lengthStr = dpValue.substring(index + 3, index + 6);

    if (!/^\d+$/.test(lengthStr)) break;

    const length = parseInt(lengthStr, 10);

    if (index + 6 + length > dpValue.length) break;

    const value = dpValue.substring(index + 6, index + 6 + length);

    switch (tag) {
      case RECEIPT_TAGS.LINE_NUMBER:
        // A line number without a separator still starts a new line
        flush();
        lineNumber = value;
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
    open = true;

    index += 6 + length;
  }

  // Don't forget the last line
  flush();

  // Mask any card numbers in receipt
  const maskedLines = lines.map((line) => ({
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
    case TLV_TAGS.DA:
      return 'Date';
    case TLV_TAGS.HE:
      return 'Time';
    case TLV_TAGS.NPRT:
      return 'Cardholder Name';
    case TLV_TAGS.DAEX:
      return 'Card Expiry';
    case TLV_TAGS.DATR:
      return 'Transaction Date';
    case TLV_TAGS.HETR:
      return 'Transaction Time';
    case TLV_TAGS.NSA:
      return 'Cancel Sequence';
    case TLV_TAGS.NHC:
      return 'Hostess Number';
    case TLV_TAGS.CB:
      return 'Barcode';
    case TLV_TAGS.TIDE:
      return 'Ticket Type';
    case TLV_TAGS.TYPA:
      return 'Transaction Type';
    case TLV_TAGS.RE:
      return 'Receipt Data';
    case TLV_TAGS.RECB:
      return 'Receipt Copy';
    case TLV_TAGS.REQU:
      return 'Request Type';
    case TLV_TAGS.RESE:
      return 'Response Message';
    case TLV_TAGS.RECO:
      return 'Receipt Confirmation';
    case TLV_TAGS.RERA:
      return 'Response Reason';
    case TLV_TAGS.MDLC:
      return 'Model Code';
    case TLV_TAGS.EM:
      return 'Entry Mode';
    default:
      return `Unknown Tag ${tag}`;
  }
}
