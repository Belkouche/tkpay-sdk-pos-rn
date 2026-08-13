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
                promise.resolve(response)

            } catch (e: Exception) {
                closeConnection()
                promise.reject("CONNECTION_ERROR", e.message, e)
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

                // Send confirmation
                outputStream?.write(tlvData.toByteArray(Charsets.UTF_8))
                outputStream?.flush()

                // Receive response
                val response = receiveResponse(timeout)

                // Close connection after confirmation
                closeConnection()

                promise.resolve(response)

            } catch (e: Exception) {
                closeConnection()
                promise.reject("CONNECTION_ERROR", e.message, e)
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
     * a 1-second inter-chunk timeout. Stop immediately on '!' or '?'.
     * Strip the terminator before returning so the TLV parser sees clean data.
     */
    private fun receiveResponse(timeout: Int): String {
        val stream = inputStream ?: throw IllegalStateException("No active socket")
        val socket = activeSocket ?: throw IllegalStateException("No active socket")
        val rawBytes = mutableListOf<Byte>()
        val buf = ByteArray(8192)

        // First read — full timeout (payment waits for customer to tap)
        socket.soTimeout = timeout
        val firstCount = stream.read(buf)
        if (firstCount == -1) throw IllegalStateException("Connection closed by terminal")
        for (i in 0 until firstCount) rawBytes.add(buf[i])

        // Drain until '!' / '?' terminator or 1-second silence
        socket.soTimeout = 1000
        while (rawBytes.last() != '!'.code.toByte() && rawBytes.last() != '?'.code.toByte()) {
            try {
                val n = stream.read(buf)
                if (n <= 0) break
                for (i in 0 until n) rawBytes.add(buf[i])
            } catch (e: java.net.SocketTimeoutException) {
                break
            }
        }

        socket.soTimeout = timeout

        if (rawBytes.isEmpty()) throw IllegalStateException("Empty response from terminal")

        val response = String(rawBytes.toByteArray(), Charsets.UTF_8)

        // Strip terminator if present
        return if (response.last() == '!' || response.last() == '?')
            response.dropLast(1) else response
    }

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
