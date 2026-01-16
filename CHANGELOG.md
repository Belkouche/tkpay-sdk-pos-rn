# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
