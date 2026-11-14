# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] - 2026-11-14

Port of the fixes verified live with the Node and C# SDKs on an Ingenico Lane3600 (USB) and a
Sunmi P2 (TCP). This SDK is TCP only, so the USB serial fixes of those SDKs do not apply.

### Fixed
- **Void frames follow spec v2 §4.3/§4.4.**
  - TM 003: TM, NCAI, NS, DA, HE, DATR, HETR, STAN, MT, NSA. NS is a new sequence generated for the void; the `sequence` passed to `cancelPayment()` (the payment's) is sent as NSA. Was: NSA only, no NS, DATR or HETR.
  - TM 004: TM, NCAI, NS (same as TM 003), STAN, MT + DE (echoed from TM 103), DATR + HETR (echoed from TM 103), DA, HE. Never NSA.
  - `cancelPayment()`'s signature is unchanged. `buildCancellationRequest(stan, ncai, sequence, amountCentimes?, originalSequence?)`: `sequence` is now the void's NS and the new `originalSequence` is NSA. `buildCancellationConfirmation` takes an options object (`amount`, `currency`, `datr`, `hetr`); a string is still read as the amount.
- **Void receipt when TM 103 has none.** The Lane3600 and the Sunmi P2 send the only void receipt with TM 104 (the Sunmi prints it "Copie Commerçant"). It is now `merchantReceipt`, with no `customerReceipt`. Terminals that send a receipt with TM 103 keep TM 103 = merchant, TM 104 = customer. A direct TM 104 reply to TM 003 no longer returns its receipt as both copies.
- **Reply cut short at a `?` or `!` inside a receipt.** The Android and iOS readers (and the Node stand-in `nodeTransport.js`) ended a reply at the first chunk ending in `!` or `?` (iOS: at any `!` or `?` received). A reply is now complete only when walking its TLV fields by their 3-digit lengths lands exactly on `!` or `?`, checked when the data ends with one; data that is not TLV falls back to "ends with `!` or `?`". The 1 s silence fallback is kept; after a silence the last `?` (possibly the DP block's own) is no longer stripped. Shared rule: `TlvFraming.kt`, `TlvFraming.swift`, `isCompleteMessage` in TS.
- **Replies over 64 KB are rejected** (`INVALID_RESPONSE` from the native module, `NapsError` `INVALID_RESPONSE` from `processPayment()`).
- **Parser:** fields are walked by their length (`fieldEnd`, shared by `parseTlv` and the reader check); `!` / `?` end a message only at a field boundary. A DP (tag 010) declared 999 long (the Lane3600 caps the length at 999 for longer receipts) is read up to its own `?` end marker by walking its receipt sub-records (030–039) and `*` separators; any other sub-record ends it at the declared length, so a following CR or card number stays its own field. TLV digits are ASCII `0`–`9` only, and malformed input never throws.
- **Card number masking:** DP masking (JS and native) covers every sub-tag value and any unparseable rest, not only the text (033). The native `PanMasker` now fails closed: if the field walk breaks, every card-shaped run in the rest of the reply is masked.
- **`networkTest()` sends nothing over TCP** and returns `success: false`, `responseCode: 'UNSUPPORTED'`. The NapsPay app on Sunmi terminals answers TM 009 with TM 101 / CR 902, and a test frame crashed the app on a Sunmi P2.
- `resetPinPad()` used a fixed 10 s timeout; it now uses `timeout` like the other management operations.

### Changed
- **`settlement()` no longer sends TM 010 nor reports a télécollecte that never happened.** The NapsPay ECR TLV spec v2.0 has no settlement message: §4.7 defines TM 010 / 110 as Payment Totals. Verified on a Sunmi P2: TM 010 returned CR 000 and the same totals ticket twice, with unchanged totals, so no batch was closed. `settlement()` now sends nothing (no connection opened) and returns `success: false`, `responseCode: 'UNSUPPORTED'`, no date, time or receipt. It is deprecated, as are `buildSettlementRequest` and `MESSAGE_TYPES.SETTLEMENT_REQUEST` / `SETTLEMENT_RESPONSE`. Run the télécollecte from the terminal's menu; use `totals()` for the daily totals ticket.

### Added
- `fieldEnd`, `isCompleteMessage`, `MAX_RESPONSE_CHARS` and the `CancellationConfirmationOptions` type are exported.
- Tests: `test-framing.test.js` (framing, DP 999, non-ASCII digits), `test-reader.test.js` (reader against a local TCP server, 64 KB cap), void frame / NS-NSA / TM 104 receipt / network test / no-terminator / timeout tests in `test-napspay-544.test.js`, `TlvFramingTest.kt`, and framing checks in the iOS native test (`npm run test:native:ios`).

## [1.6.0] - 2026-11-09

- **Removed the gateway notification.** `processPayment()` no longer sends a background `POST` to
  `https://api.tkpay.ma` after each payment. The SDK only talks to the terminal.

## [1.5.1] - 2026-11-07

- Card numbers are masked (first 6 + last 4 digits) and the full number is never exposed or logged:
  - **In the native modules.** Android (`PanMasker.kt`) and iOS (`PanMasker.swift`) mask the terminal's reply (tag 007 and the DP receipt text) before passing it to JavaScript, replacing digits one for one so TLV lengths are unchanged. `parseTlv` masks again (tag 007 and DP text) as a second layer.
  - **Tag 007 (NCAR):** always first 6 digits, `*`, last 4 digits, whatever grouping it arrived in.
  - **Receipt text:** every card-shaped run (13+ digits, consecutive digits adjacent or separated by exactly one space, dash, dot, tab or non-breaking space) has all digits masked except the first 6 and last 4 of the run, including runs over 19 digits. Separators and layout are kept; dates, times, amounts and shorter numbers are untouched. Was: 16 contiguous digits only.
  - Shared test vectors in `test-fixtures/pan-vectors.json`, run by the JS tests, the Android JUnit test (`android/src/test`) and the iOS Swift test (`npm run test:native:ios`).
- `test-protocol.js` no longer prints a raw frame or full test card numbers.
- iOS: `testConnection` now bridges its CFStreams to `InputStream` / `OutputStream` (`as InputStream?`); it did not compile with the current Swift toolchain.
- Card number tests `test-pan.test.js`: a reply with a full PAN in tag 007 and spaced / 19-digit numbers in receipt lines leaves no full number in results, receipts, request frames, errors, the gateway notification or captured console output.

## [1.5.0] - 2026-11-06

NapsPay v5.4.4 sync with the canonical C# SDK (v1.5.0), verified against the v5.4.4 emulator (two-phase void, `confirm_error` mode).

### Fixed
- **Receipts are now exactly what the terminal sends (spec §5).**
  - Removed the SDK branding that replaced the first centred line containing "naps" with `TKPAY` and inserted a `Powered by NAPS` line.
  - The payment merchant copy no longer gets `STAN:` / `NCAI:` / `SEQ:` lines added (`enhanceMerchantReceipt` removed).
  - Lines with empty text are kept, and every `*`-separated group (or new DP1 line number) is its own line, so nothing is dropped or merged.
  - `settlement()` now returns the TM 110 receipt in `SettlementResult.receipt`.
- **DP block dropped when it contained `?` or `!`.** `parseTlv` now only treats `!` / `?` as the end of the frame where a tag is expected; inside a value (a DP block ends with `?`, receipt text may contain `!`) they are data.
- Card numbers in receipt text are masked for 13 to 19 digits (was 16 only).
- **Receipts parsed to their first line only.** `parseReceipt` now skips the `*` separator between print lines and the final `?` marker of a DP block (spec §5), so every line is returned. A `*` inside a line's text (e.g. a masked PAN) is kept.
- **Refused payment confirmation reported as approved.** A TM=102 with CR ≠ 000 (e.g. 302 sale not found, 482 already cancelled — the terminal auto-reverses) now yields a failed `PaymentResult` with the decline receipt instead of `success: true`.

### Added
- `CancellationResult.merchantReceipt` (DP of TM=103) and `CancellationResult.customerReceipt` (DP of TM=104).
- `MESSAGE_TYPES.CANCELLATION_CONFIRMATION_RESPONSE` (`'104'`); `CANCELLATION_CORRECTION` is kept as a deprecated alias.
- Response codes 265, 281, 385, 400, 500 and 888 from the NapsPay ISO table.
- Receipt tests `test-receipts.test.js` with raw emulator frames (`test-fixtures/emulator-receipts.json`), asserting the exact merchant and customer copies for payment and void.
- Runnable Node quickstart `example/quickstart/quickstart.js` (same code as the README quickstart) and `example/quickstart/nodeTransport.js`, a Node TCP stand-in for the native module.
- Emulator integration tests `test-integration.test.js`, selected by mode: `NAPS_PORT=4456 NAPS_EMULATOR_MODE=<mode> npm run test:integration` against `naps_emulator.py --port 4456 --mode <mode>`. Covers approve, decline, confirm_error, void_480, void_995, void_no_confirm and void_refuse.

### Changed
- `cancelPayment` follows the NapsPay ECR TLV spec v2.0 §4.3/§4.4 (TM=103 CR=000 only means "transaction found"; TM=004 executes the reversal):
  - TM=104 **CR=480 or 000** = cancellation completed (`success: true`). CR=480 was previously reported as a failure.
  - TM=104 **CR=995** = unconfirmed: `success: false`, `pendingConfirmation: true`. It was previously reported as success; the spec defines 995 as "Server processing error", but it was seen with successful voids on the live terminal.
  - A **missing TM=104 reply** (timeout) fails closed the same way: `success: false`, `pendingConfirmation: true`, with the TM=103 STAN and merchant receipt.
  - Any other TM=104 CR is a failure. A direct MT=104 reply to TM=003 uses the same rules.
  - New `CancellationResult.pendingConfirmation` — verify the void by STAN with `printDuplicate` (TM=008) before treating it as done.
- TM=004 carries the TM=003 sequence in NS (tag 004, spec: 004.NS = 003.NS) and the amount echoed from TM=103 — unchanged; now covered by a unit test.
- Response-code descriptions aligned with the C# SDK: 383 "Balance updated", 481 "Reversal amount incorrect", 581 "Reconciliation already done".

## [1.4.0] - 2026-11-06

NapsPay v5.4.4 sync with the canonical C# SDK (v1.4.0).

### Added
- `totals(registerId, cashierId)` — TM=010 totals report carrying a sequence number (NS); returns `TotalsResult` with the totals receipt.
- `referencing(registerId, cashierId, tide?)` now sends the TIDE (tag 020) parameter-set selector — `TIDE.MERCHANT` `"01"` (default) or `TIDE.RECHARGE` `"02"` — and reports it as `ReferencingResult.parameterSet`. New `TIDE` constant.
- `buildField` and `buildTotalsRequest` exported for advanced use.
- Unit tests `test-napspay-544.test.js` (run by `npm test`).

### Changed
- Payment request (TM=001) now carries DATR/HETR (tags 018/019) alongside DA/HE.
- Management requests (TM=008/009/012/013) now carry the sequence number (NS / tag 004) after NCAI; the client passes its generated sequence.
- `processPayment`: the merchant receipt now comes from the Phase‑1 response (TM=101) DP and the customer receipt from the Phase‑2 response (TM=102) DP. Both were previously parsed from the Phase‑2 DP.
- Declined payments now return the masked PAN and the decline receipt (`merchantReceipt`).

## [1.3.0] - 2026-09-12

### Added
- **NAPS TLV v2 protocol support.**
- Enriched Payment Confirmation (TM=002, spec §4.2): `buildConfirmationRequest(stan, ncai, sequence, options?)` now accepts an optional `ConfirmationOptions` ({ amountCentimes, ncar, daex, currency }) and emits MT/DE, NCAR and DAEX in the reference field order (TM, NCAI, NS, [MT, DE], STAN, [NCAR], [DAEX], DA, HE). Old three-argument callers keep working unchanged.
- `processPayment` now threads the amount (MT/DE), masked PAN (NCAR) and card expiry (DAEX) from the approved Phase‑1 response (TM=101) into the Phase‑2 confirmation.
- `protocolVersion` option on `NapsConfig` (new `ProtocolVersion` enum, `v1`/`v2`), defaulting to `V2`. Selects the expected response terminator (`!` = v2, `?` = v1); the native transport already accepts either.
- `describeResponseCode(cr)` and `isApproved(cr)` helpers plus the `RESPONSE_CODES` / `APPROVED_CODES` tables covering the v2 §6 response codes. Failed payment results now carry the human‑readable §6 description.
- Unit tests (`test-protocol-v2.test.js`, run via `npm test` with Node's built-in test runner) covering the enriched confirmation, both terminators, and the response-code helpers.

### Changed
- `parseTlv` now explicitly stops at the first `!` or `?` terminator, ignoring any trailing content.
- Fixed `tsconfig.json` `moduleResolution` (`bundler` → `node10`) so the CommonJS build compiles under TypeScript 5.9.

## [1.1.0] - 2026-07-22

### Added
- `networkTest(registerId, cashierId)` — sends TM=009 M2M network test and returns RC + round-trip time. Replaces the TCP-only `testConnection()` for proper protocol-level health checks.
- `cancelPayment(stan, registerId, cashierId, sequence)` — TM=003 void/cancellation of a previous transaction by STAN.
- `printDuplicate(registerId, cashierId, stan?)` — TM=008 reprint the last receipt or a specific transaction by STAN.
- `resetPinPad(registerId, cashierId)` — TM=012 reset the terminal to idle ("Attente Caisse") state.
- `referencing(registerId, cashierId)` — TM=013 sync merchant configuration from the NAPS server. Must run at least once before the first payment.
- New result types: `CancellationResult`, `NetworkTestResult`, `DuplicateReceiptResult`, `ResetResult`, `ReferencingResult`.
- New TLV builders exported for advanced use: `buildCancellationRequest`, `buildNetworkTestRequest`, `buildDuplicateRequest`, `buildResetRequest`, `buildReferencingRequest`.
- Extended `MESSAGE_TYPES` constant to include all 8 message types (TM=003/008/009/012/013 and their responses).
- Fixed `tsconfig.json`: removed deprecated `baseUrl` and `moduleResolution: node` options (TS5102/TS5108).

## [1.0.3] - 2026-01-19

### Added
- Merchant receipt now includes STAN, NCAI, and Sequence Number for reconciliation
- New `PAYMENT_RESPONSE_EXAMPLE.md` documentation with complete payment response examples
- Documented common response codes (17 codes) and card entry modes

### Changed
- Enhanced `buildSuccessResult` to inject transaction identifiers into merchant receipt
- Added `enhanceMerchantReceipt` function in TlvProtocol for receipt enhancement

## [1.0.2] - 2026-01-16

### Fixed
- **Critical**: Fixed socket timeout issue in Android native module that caused premature connection drops
  - The `receiveResponse` function was setting `socket.soTimeout = 1000` (1 second) before reading, causing timeouts while waiting for terminal response
  - Now uses the full timeout parameter for initial read (waiting for customer to tap card), then short timeout only for end-of-message detection
- **iOS**: Improved `receiveResponse` timeout handling to properly wait for terminal response during payment flow
  - Uses full timeout for initial data wait
  - Added connection state monitoring (error/closed detection)
  - Short timeout (500ms) only used after initial data received

### Changed
- Android: Refactored `receiveResponse` to separate initial read (with full timeout) from end-of-message detection (with short timeout)
- iOS: Refactored `receiveResponse` to use `Date` based timeout calculation for more accurate timing

## [1.0.1] - 2026-01-16

### Fixed
- Prevent instant timeouts by enforcing a minimum timeout value of 1000ms
- Add a console warning to notify developers when the configured timeout is too low and has been adjusted
- TypeScript compilation errors in `GatewayNotifier.ts`
- Added `"DOM"` to tsconfig lib array for browser globals support
- Fixed platform detection to not use `require('react-native')`

## [1.0.0] - 2025-11-27

### Added
- Initial release of React Native NAPS SDK
- Two-phase payment flow support (TM 001 → TM 002)
- Automatic PAN masking (first 6 + last 4 digits)
- Receipt parsing with TKPAY branding
- Native TCP communication modules for iOS (Swift) and Android (Kotlin)
- Fire-and-forget transaction notifications to TKPay gateway
- TypeScript type definitions
- Example React Native application
