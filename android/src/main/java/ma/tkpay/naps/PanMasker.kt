package ma.tkpay.naps

/**
 * Masks card numbers in a raw terminal reply before it crosses the bridge to JS.
 *
 * - Tag 007 (NCAR): every digit except the first 6 and last 4 becomes '*'.
 * - Tag 010 (DP): in every sub-tag value (and any unparseable rest), every card-shaped run is
 *   masked the same way. A card-shaped run is 13+ digits where consecutive
 *   digits are adjacent or separated by exactly one space, dash, dot, tab or
 *   non-breaking space; runs over 19 digits are masked too.
 *
 * If the field walk breaks (not TLV, or a field longer than the reply), every
 * card-shaped run in the rest of the reply is masked (fail closed).
 *
 * Digits are replaced one for one, so the reply length, every TLV length and
 * the receipt layout stay unchanged. Same rule as the JS layer (TlvProtocol.ts).
 */
internal object PanMasker {
    private const val TAG_NCAR = "007"
    private const val TAG_DP = "010"
    private const val MIN_RUN_DIGITS = 13

    fun maskReply(reply: String): String {
        val out = StringBuilder(reply)
        var i = 0
        while (i + 6 <= reply.length) {
            if (reply[i] == '!' || reply[i] == '?') break
            // Same field walk as the reader: a DP declared 999 runs to its own '?'
            val end = TlvFraming.fieldEnd(reply, i)
            if (end < 0 || end > reply.length) {
                // Fail closed: the walk broke, mask every card-shaped run in the rest
                var restStart = i
                if (reply.startsWith(TAG_DP, i) && reply.substring(i + 3, i + 6).all { it in '0'..'9' }) {
                    val dpEnd = minOf(i + 6 + reply.substring(i + 3, i + 6).toInt(), reply.length)
                    maskReceiptBlock(out, i + 6, dpEnd)
                    restStart = dpEnd
                }
                maskRuns(out, restStart, reply.length)
                break
            }
            val tag = reply.substring(i, i + 3)
            val start = i + 6
            when (tag) {
                TAG_NCAR -> maskDigits(out, start, end)
                TAG_DP -> maskReceiptBlock(out, start, end)
            }
            i = end
        }
        return out.toString()
    }

    /** Masks card-shaped runs in free text. */
    fun maskText(text: String): String {
        val out = StringBuilder(text)
        maskRuns(out, 0, text.length)
        return out.toString()
    }

    private fun maskReceiptBlock(out: StringBuilder, start: Int, end: Int) {
        var i = start
        while (i < end) {
            if (out[i] == '*' || out[i] == '?') {
                i++
                continue
            }
            val lengthStr = if (i + 6 <= end) out.substring(i + 3, i + 6) else ""
            val valueEnd = i + 6 + (lengthStr.toIntOrNull() ?: Int.MAX_VALUE / 2)
            if (lengthStr.length != 3 || !lengthStr.all { it in '0'..'9' } || valueEnd > end) {
                // Not a sub-tag: mask what is left as plain text
                maskRuns(out, i, end)
                return
            }
            maskRuns(out, i + 6, valueEnd)
            i = valueEnd
        }
    }

    private fun isSeparator(c: Char) = c == ' ' || c == '-' || c == '.' || c == '\t' || c == ' '

    private fun isDigit(c: Char) = c in '0'..'9'

    /** Finds each card-shaped run in [start, end) and masks it. */
    private fun maskRuns(out: StringBuilder, start: Int, end: Int) {
        var i = start
        while (i < end) {
            if (!isDigit(out[i])) {
                i++
                continue
            }
            var runEnd = i + 1
            var digits = 1
            while (true) {
                if (runEnd < end && isDigit(out[runEnd])) {
                    runEnd++
                    digits++
                } else if (runEnd + 1 < end && isSeparator(out[runEnd]) && isDigit(out[runEnd + 1])) {
                    runEnd += 2
                    digits++
                } else {
                    break
                }
            }
            if (digits >= MIN_RUN_DIGITS) maskDigits(out, i, runEnd)
            i = runEnd
        }
    }

    /** Replaces every digit in [start, end) except the first 6 and last 4 with '*'. */
    private fun maskDigits(out: StringBuilder, start: Int, end: Int) {
        var digitCount = 0
        for (k in start until end) if (isDigit(out[k])) digitCount++
        if (digitCount < 10) return
        var index = 0
        for (k in start until end) {
            if (!isDigit(out[k])) continue
            if (index >= 6 && index < digitCount - 4) out.setCharAt(k, '*')
            index++
        }
    }
}
