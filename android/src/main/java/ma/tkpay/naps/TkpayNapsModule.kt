package ma.tkpay.naps

import com.facebook.react.bridge.*
import kotlinx.coroutines.*
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket

/**
 * React Native module for NAPS Pay TCP communication
 */
class TkpayNapsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var activeSocket: Socket? = null
    private var outputStream: OutputStream? = null
    private var inputStream: InputStream? = null

    override fun getName(): String = "TkpayNaps"

    override fun invalidate() {
        super.invalidate()
        scope.cancel()
        closeConnection()
    }

    /**
     * Send payment request to terminal
     * Opens a new connection and keeps it open for confirmation
     */
    @ReactMethod
    fun sendPaymentRequest(
        host: String,
        port: Int,
        tlvData: String,
        timeout: Int,
        promise: Promise
    ) {
        scope.launch {
            try {
                // Close any existing connection
                closeConnection()

                // Open new connection
                val socket = Socket()
                socket.soTimeout = timeout
                socket.connect(InetSocketAddress(host, port), timeout)

                activeSocket = socket
                outputStream = socket.getOutputStream()
                inputStream = socket.getInputStream()

                // Send data
                outputStream?.write(tlvData.toByteArray(Charsets.UTF_8))
                outputStream?.flush()

                // Receive response
                val response = receiveResponse(timeout)

                // Keep connection open for confirmation
                promise.resolve(PanMasker.maskReply(response))

            } catch (e: Exception) {
                closeConnection()
                promise.reject(errorCode(e), e.message, e)
            }
        }
    }

    /**
     * Send confirmation on existing connection
     * Must be called after sendPaymentRequest
     */
    @ReactMethod
    fun sendConfirmation(tlvData: String, timeout: Int, promise: Promise) {
        scope.launch {
            try {
                val socket = activeSocket
                if (socket == null || socket.isClosed) {
                    promise.reject("CONNECTION_ERROR", "No active connection")
                    return@launch
                }

                // Update timeout
                socket.soTimeout = timeout

                // Send data only if non-empty (empty = receive-only, e.g. waiting for MT=104)
                if (tlvData.isNotEmpty()) {
                    outputStream?.write(tlvData.toByteArray(Charsets.UTF_8))
                    outputStream?.flush()
                }

                // Receive response
                val response = receiveResponse(timeout)

                // Close connection after confirmation
                closeConnection()

                promise.resolve(PanMasker.maskReply(response))

            } catch (e: Exception) {
                closeConnection()
                promise.reject(errorCode(e), e.message, e)
            }
        }
    }

    /**
     * Test connection to terminal
     */
    @ReactMethod
    fun testConnection(host: String, port: Int, timeout: Int, promise: Promise) {
        scope.launch {
            try {
                val socket = Socket()
                socket.soTimeout = timeout
                socket.connect(InetSocketAddress(host, port), timeout)
                socket.close()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }
    }

    /**
     * Receive a complete TLV response from the terminal.
     *
     * Terminal firmware variants differ:
     *   - Some append '!' as end-of-message terminator
     *   - Some append '?' as end-of-message terminator
     *   - Some send nothing and just stop writing
     *
     * Strategy: read with full timeout for the first byte, then drain with
     * a 1-second inter-chunk timeout. The reply is complete when walking its
     * TLV fields by length lands on '!' or '?' (TlvFraming); a terminator inside
     * a value (receipt lines end with '?') is data. Replies over 64 KB are
     * rejected. The terminator of a complete reply is stripped.
     */
    private fun receiveResponse(timeout: Int): String {
        val stream = inputStream ?: throw IllegalStateException("No active socket")
        val socket = activeSocket ?: throw IllegalStateException("No active socket")
        val raw = java.io.ByteArrayOutputStream()
        val buf = ByteArray(8192)

        // First read — full timeout (payment waits for customer to tap)
        socket.soTimeout = timeout
        val firstCount = stream.read(buf)
        if (firstCount == -1) throw IllegalStateException("Connection closed by terminal")
        raw.write(buf, 0, firstCount)

        // Drain until the reply is complete or 1-second silence
        socket.soTimeout = 1000
        var complete = TlvFraming.isReplyEnd(raw.toByteArray(), raw.size())
        while (!complete) {
            try {
                val n = stream.read(buf)
                if (n <= 0) break
                raw.write(buf, 0, n)
            } catch (e: java.net.SocketTimeoutException) {
                break
            }
            complete = TlvFraming.isReplyEnd(raw.toByteArray(), raw.size())
        }

        socket.soTimeout = timeout

        if (raw.size() == 0) throw IllegalStateException("Empty response from terminal")

        val response = String(raw.toByteArray(), Charsets.UTF_8)

        // Strip the terminator of a complete reply; after a silence the last '?' may be the DP's own
        return if (complete) response.dropLast(1) else response
    }

    private fun errorCode(e: Exception) =
        if (e is InvalidResponseException) "INVALID_RESPONSE" else "CONNECTION_ERROR"

    /**
     * Close active connection
     */
    private fun closeConnection() {
        try {
            outputStream?.close()
            inputStream?.close()
            activeSocket?.close()
        } catch (e: Exception) {
            // Ignore errors during close
        } finally {
            outputStream = null
            inputStream = null
            activeSocket = null
        }
    }
}
