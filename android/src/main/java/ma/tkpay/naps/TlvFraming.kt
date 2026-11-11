package ma.tkpay.naps

/** Reply larger than [TlvFraming.MAX_RESPONSE_BYTES]; rejected as INVALID_RESPONSE. */
internal class InvalidResponseException(message: String) : Exception(message)

/**
 * TLV framing shared by the reply reader (TkpayNapsModule) and PanMasker.
 * Same rules as fieldEnd / isCompleteMessage in TlvProtocol.ts.
 */
internal object TlvFraming {
    /** Largest reply accepted (replies seen are ~2 KB). */
    const val MAX_RESPONSE_BYTES = 64 * 1024

    private fun isTerminator(c: Char) = c == '!' || c == '?'

    /** Value of [count] ASCII digits at [start], or -1 if out of range or any is not '0'..'9'. */
    private fun number(data: String, start: Int, count: Int): Int {
        if (start < 0 || start + count > data.length) return -1
        var value = 0
        for (k in start until start + count) {
            val c = data[k]
            if (c !in '0'..'9') return -1
            value = value * 10 + (c - '0')
        }
        return value
    }

    /**
     * End index (exclusive) of the field starting at [pos], or -1 if its header is not 3 + 3
     * ASCII digits. Can be past data.length when the field is not fully received yet. A DP (010)
     * declared 999 long ends at its own '?' end marker, found by walking its sub-records
     * (3-digit sub-tag + 3-digit length + value) and '*' line separators; the value includes it.
     */
    fun fieldEnd(data: String, pos: Int): Int {
        val tag = number(data, pos, 3)
        val length = number(data, pos + 3, 3)
        if (tag < 0 || length < 0) return -1
        val declaredEnd = pos + 6 + length
        if (tag != 10 || length != 999) return declaredEnd
        var i = pos + 6
        while (i < data.length) {
            if (data[i] == '*') {
                i++
                continue
            }
            if (data[i] == '?') return maxOf(i + 1, declaredEnd)
            if (i + 6 > data.length) return data.length + 1 // rest of the receipt not received yet
            val subLength = number(data, i + 3, 3)
            if (number(data, i, 3) < 0 || subLength < 0) return declaredEnd
            i += 6 + subLength
        }
        return data.length + 1
    }

    /**
     * True once [buf] holds a complete reply: walking the fields by their length lands on a
     * '!' or '?'. A terminator inside a value (receipt lines end with '?') is data. If the data
     * is not TLV, a trailing terminator ends it.
     */
    fun isCompleteMessage(buf: String): Boolean {
        var pos = 0
        while (pos < buf.length) {
            if (isTerminator(buf[pos])) return true
            if (pos + 6 > buf.length) return false
            val end = fieldEnd(buf, pos)
            if (end < 0) return isTerminator(buf.last())
            pos = end
        }
        return false
    }

    /**
     * Reader check after each chunk: throws past [MAX_RESPONSE_BYTES], and walks the fields
     * only when the data ends with '!' or '?'.
     */
    fun isReplyEnd(bytes: ByteArray, count: Int): Boolean {
        if (count > MAX_RESPONSE_BYTES) {
            throw InvalidResponseException("Response larger than $MAX_RESPONSE_BYTES bytes")
        }
        if (count == 0) return false
        val last = bytes[count - 1]
        if (last != '!'.code.toByte() && last != '?'.code.toByte()) return false
        return isCompleteMessage(String(bytes, 0, count, Charsets.UTF_8))
    }
}
