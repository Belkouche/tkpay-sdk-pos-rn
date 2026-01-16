import Foundation

/**
 * NAPS Pay TCP communication module for iOS
 */
@objc(TkpayNaps)
class TkpayNaps: NSObject {

    private var inputStream: InputStream?
    private var outputStream: OutputStream?
    private var activeHost: String?
    private var activePort: Int?

    /**
     * Send payment request to terminal
     * Opens a new connection and keeps it open for confirmation
     */
    @objc(sendPaymentRequest:port:tlvData:timeout:resolver:rejecter:)
    func sendPaymentRequest(
        _ host: String,
        port: Int,
        tlvData: String,
        timeout: Int,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            // Close any existing connection
            self.closeConnection()

            do {
                // Open new connection
                try self.openConnection(host: host, port: port, timeout: timeout)

                // Send data
                try self.sendData(tlvData)

                // Receive response
                let response = try self.receiveResponse(timeout: timeout)

                // Keep connection open for confirmation
                resolve(response)

            } catch {
                self.closeConnection()
                reject("CONNECTION_ERROR", error.localizedDescription, error)
            }
        }
    }

    /**
     * Send confirmation on existing connection
     */
    @objc(sendConfirmation:timeout:resolver:rejecter:)
    func sendConfirmation(
        _ tlvData: String,
        timeout: Int,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            guard self.outputStream != nil && self.inputStream != nil else {
                reject("CONNECTION_ERROR", "No active connection", nil)
                return
            }

            do {
                // Send confirmation
                try self.sendData(tlvData)

                // Receive response
                let response = try self.receiveResponse(timeout: timeout)

                // Close connection after confirmation
                self.closeConnection()

                resolve(response)

            } catch {
                self.closeConnection()
                reject("CONNECTION_ERROR", error.localizedDescription, error)
            }
        }
    }

    /**
     * Test connection to terminal
     */
    @objc(testConnection:port:timeout:resolver:rejecter:)
    func testConnection(
        _ host: String,
        port: Int,
        timeout: Int,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            var readStream: Unmanaged<CFReadStream>?
            var writeStream: Unmanaged<CFWriteStream>?

            CFStreamCreatePairWithSocketToHost(
                kCFAllocatorDefault,
                host as CFString,
                UInt32(port),
                &readStream,
                &writeStream
            )

            guard let inputStream = readStream?.takeRetainedValue(),
                  let outputStream = writeStream?.takeRetainedValue() else {
                resolve(false)
                return
            }

            inputStream.open()
            outputStream.open()

            // Wait a bit for connection
            Thread.sleep(forTimeInterval: 0.5)

            let connected = inputStream.streamStatus == .open && outputStream.streamStatus == .open

            inputStream.close()
            outputStream.close()

            resolve(connected)
        }
    }

    // MARK: - Private Methods

    private func openConnection(host: String, port: Int, timeout: Int) throws {
        var readStream: Unmanaged<CFReadStream>?
        var writeStream: Unmanaged<CFWriteStream>?

        CFStreamCreatePairWithSocketToHost(
            kCFAllocatorDefault,
            host as CFString,
            UInt32(port),
            &readStream,
            &writeStream
        )

        guard let input = readStream?.takeRetainedValue(),
              let output = writeStream?.takeRetainedValue() else {
            throw NSError(domain: "TkpayNaps", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to create streams"])
        }

        inputStream = input as InputStream
        outputStream = output as OutputStream

        inputStream?.open()
        outputStream?.open()

        activeHost = host
        activePort = port

        // Wait for connection to establish
        var attempts = 0
        let maxAttempts = timeout / 100

        while attempts < maxAttempts {
            if inputStream?.streamStatus == .open && outputStream?.streamStatus == .open {
                return
            }
            if inputStream?.streamStatus == .error || outputStream?.streamStatus == .error {
                let error = inputStream?.streamError ?? outputStream?.streamError
                throw error ?? NSError(domain: "TkpayNaps", code: -1, userInfo: [NSLocalizedDescriptionKey: "Connection failed"])
            }
            Thread.sleep(forTimeInterval: 0.1)
            attempts += 1
        }

        throw NSError(domain: "TkpayNaps", code: -1, userInfo: [NSLocalizedDescriptionKey: "Connection timeout"])
    }

    private func sendData(_ data: String) throws {
        guard let outputStream = outputStream,
              let bytes = data.data(using: .utf8) else {
            throw NSError(domain: "TkpayNaps", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to encode data"])
        }

        let written = bytes.withUnsafeBytes { buffer in
            outputStream.write(buffer.bindMemory(to: UInt8.self).baseAddress!, maxLength: bytes.count)
        }

        if written < 0 {
            throw outputStream.streamError ?? NSError(domain: "TkpayNaps", code: -1, userInfo: [NSLocalizedDescriptionKey: "Write failed"])
        }
    }

    private func receiveResponse(timeout: Int) throws -> String {
        guard let inputStream = inputStream else {
            throw NSError(domain: "TkpayNaps", code: -1, userInfo: [NSLocalizedDescriptionKey: "No input stream"])
        }

        var response = Data()
        let bufferSize = 8192
        var buffer = [UInt8](repeating: 0, count: bufferSize)

        // Wait for initial data with full timeout
        // This is critical - payment can take 30-120 seconds while customer taps card
        let timeoutSeconds = Double(timeout) / 1000.0
        let startTime = Date()

        while Date().timeIntervalSince(startTime) < timeoutSeconds {
            if inputStream.hasBytesAvailable {
                break
            }
            if inputStream.streamStatus == .error {
                throw inputStream.streamError ?? NSError(domain: "TkpayNaps", code: -1, userInfo: [NSLocalizedDescriptionKey: "Stream error"])
            }
            if inputStream.streamStatus == .closed || inputStream.streamStatus == .atEnd {
                throw NSError(domain: "TkpayNaps", code: -1, userInfo: [NSLocalizedDescriptionKey: "Connection closed"])
            }
            // Check every 100ms
            Thread.sleep(forTimeInterval: 0.1)
        }

        if !inputStream.hasBytesAvailable {
            throw NSError(domain: "TkpayNaps", code: -1, userInfo: [NSLocalizedDescriptionKey: "Timeout waiting for response"])
        }

        // Read initial data
        let bytesRead = inputStream.read(&buffer, maxLength: bufferSize)
        if bytesRead > 0 {
            response.append(contentsOf: buffer[0..<bytesRead])
        } else if bytesRead < 0 {
            throw inputStream.streamError ?? NSError(domain: "TkpayNaps", code: -1, userInfo: [NSLocalizedDescriptionKey: "Read failed"])
        }

        // Read any remaining data with short timeout (500ms)
        let endTime = Date().addingTimeInterval(0.5)
        while Date() < endTime {
            if inputStream.hasBytesAvailable {
                let additionalBytesRead = inputStream.read(&buffer, maxLength: bufferSize)
                if additionalBytesRead > 0 {
                    response.append(contentsOf: buffer[0..<additionalBytesRead])
                } else {
                    break
                }
            } else {
                Thread.sleep(forTimeInterval: 0.05)
            }
        }

        guard let responseString = String(data: response, encoding: .utf8), !responseString.isEmpty else {
            throw NSError(domain: "TkpayNaps", code: -1, userInfo: [NSLocalizedDescriptionKey: "Empty response"])
        }

        return responseString
    }

    private func closeConnection() {
        inputStream?.close()
        outputStream?.close()
        inputStream = nil
        outputStream = nil
        activeHost = nil
        activePort = nil
    }
}
