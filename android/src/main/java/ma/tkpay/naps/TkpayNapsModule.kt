package ma.tkpay.naps

import com.facebook.react.bridge.*
import kotlinx.coroutines.*
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.InetSocketAddress
import java.net.Socket

/**
 * React Native module for NAPS Pay TCP communication
 */
class TkpayNapsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var activeSocket: Socket? = null
    private var writer: PrintWriter? = null
    private var reader: BufferedReader? = null

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
                writer = PrintWriter(socket.getOutputStream(), true)
                reader = BufferedReader(InputStreamReader(socket.getInputStream()))

                // Send data
                writer?.print(tlvData)
                writer?.flush()

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
                writer?.print(tlvData)
                writer?.flush()

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
     * Receive response from socket
     * Uses the provided timeout for initial read (waiting for terminal response)
     * Then uses short timeout for detecting end of message
     */
    private fun receiveResponse(timeout: Int): String {
        val response = StringBuilder()
        val buffer = CharArray(8192)
        val socket = activeSocket ?: throw IllegalStateException("No active socket")

        // Use the full timeout for the first read (waiting for terminal to respond)
        // This is critical - payment can take 30-120 seconds while customer taps card
        socket.soTimeout = timeout

        try {
            // First read - wait for terminal response with full timeout
            val initialCount = reader?.read(buffer) ?: -1
            if (initialCount == -1) {
                throw IllegalStateException("Connection closed by terminal")
            }
            if (initialCount > 0) {
                response.append(buffer, 0, initialCount)
            }

            // Now set short timeout to detect end of message
            // (check if more data is available)
            socket.soTimeout = 500

            // Read any remaining data with short timeout
            while (true) {
                try {
                    val count = reader?.read(buffer) ?: -1
                    if (count <= 0) break
                    response.append(buffer, 0, count)
                } catch (e: java.net.SocketTimeoutException) {
                    // Timeout means we have all data - this is expected
                    break
                }
            }
        } finally {
            // Restore original timeout for potential future reads
            socket.soTimeout = timeout
        }

        if (response.isEmpty()) {
            throw IllegalStateException("Empty response from terminal")
        }

        return response.toString()
    }

    /**
     * Close active connection
     */
    private fun closeConnection() {
        try {
            writer?.close()
            reader?.close()
            activeSocket?.close()
        } catch (e: Exception) {
            // Ignore errors during close
        } finally {
            writer = null
            reader = null
            activeSocket = null
        }
    }
}
