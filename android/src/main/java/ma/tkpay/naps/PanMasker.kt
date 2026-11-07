package ma.tkpay.naps

/**
 * Masks card numbers in a raw terminal reply before it crosses the bridge to JS.
 *
 * - Tag 007 (NCAR): every digit except the first 6 and last 4 becomes '*'.
 * - Tag 010 (DP): in each line's text (sub-tag 033), every card-shaped run is
 *   masked the same way. A card-shaped run is 13+ digits where consecutive
 *   digits are adjacent or separated by exactly one space, dash, dot, tab or
 *   non-breaking space; runs over 19 digits are masked too.
 *
 * Digits are replaced one for one, so the reply length, every TLV length and
 * the receipt layout stay unchanged. Same rule as the JS layer (TlvProtocol.ts).
 */
internal object PanMasker {
    private const val TAG_NCAR = "007"
    private const val TAG_DP = "010"
    private const val TAG_CONTENT = "033"
    private const val MIN_RUN_DIGITS = 13

    fun maskReply(reply: String): String {
        val out = StringBuilder(reply)
        var i = 0
        while (i + 6 <= reply.length) {
            if (reply[i] == '!' || reply[i] == '?') break
            val tag = reply.substring(i, i + 3)
            val lengthStr = reply.substring(i + 3, i + 6)
            if (!tag.all { it in '0'..'9' } || !lengthStr.all { it in '0'..'9' }) break
            val start = i + 6
            val end = start + lengthStr.toInt()
            if (end > reply.length) break
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
            if (out.substring(i, i + 3) == TAG_CONTENT) maskRuns(out, i + 6, valueEnd)
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
