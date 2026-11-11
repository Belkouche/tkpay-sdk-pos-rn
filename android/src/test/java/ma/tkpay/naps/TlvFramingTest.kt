package ma.tkpay.naps

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Reply framing: same rules as fieldEnd / isCompleteMessage in TlvProtocol.ts. */
class TlvFramingTest {
    private fun field(tag: String, value: String) = tag + value.length.toString().padStart(3, '0') + value
    private fun line(n: Int, text: String) =
        field("030", n.toString().padStart(2, '0')) + field("031", "S") + field("032", "G") + field("033", text)

    private val head = field("001", "101") + field("013", "000") + field("008", "000042")
    private val receipt = line(1, "TOTAL?") + "*" + line(2, "MERCI!") + "?"
    private val frame = head + field("010", receipt) + field("016", "CLIENT") + "!"

    @Test
    fun terminatorInsideAReceiptLineIsData() {
        val cutQ = frame.substring(0, frame.indexOf("TOTAL?") + 6)
        val cutB = frame.substring(0, frame.indexOf("MERCI!") + 6)
        assertFalse(TlvFraming.isCompleteMessage(cutQ))
        assertFalse(TlvFraming.isCompleteMessage(cutB))
        assertFalse(TlvFraming.isReplyEnd(cutQ.toByteArray(), cutQ.length))
        assertTrue(TlvFraming.isCompleteMessage(frame))
        assertTrue(TlvFraming.isReplyEnd(frame.toByteArray(), frame.length))
    }

    @Test
    fun boundaryTerminatorAndNonTlvFallback() {
        assertTrue(TlvFraming.isCompleteMessage("$head?"))
        assertFalse(TlvFraming.isCompleteMessage(head))
        assertTrue(TlvFraming.isCompleteMessage("HELLO!"))
        assertFalse(TlvFraming.isReplyEnd("${head}0".toByteArray(), head.length + 1))
    }

    @Test
    fun repliesOver64KbAreRejected() {
        val big = ByteArray(TlvFraming.MAX_RESPONSE_BYTES + 1) { 'X'.code.toByte() }
        assertThrows(InvalidResponseException::class.java) { TlvFraming.isReplyEnd(big, big.size) }
    }

    @Test
    fun dpDeclared999EndsAtItsOwnEndMarker() {
        val long = (1..60).joinToString("*") { line(it, "LIGNE $it ..........") } + "?"
        assertTrue(long.length > 999)
        val reply = head + "010999" + long + field("016", "CLIENT") + "!"
        assertEquals(head.length + 6 + long.length, TlvFraming.fieldEnd(reply, head.length))
        assertTrue(TlvFraming.isCompleteMessage(reply))
        assertFalse(TlvFraming.isCompleteMessage(reply.substring(0, head.length + 1500) + "?"))
        val withPan = head + "010999" + long.replace("LIGNE 60 ..........", "5167940000123315...") + "!"
        assertFalse(PanMasker.maskReply(withPan).contains("5167940000123315"))
    }

    @Test
    fun dpDeclared999WithoutEndMarkerStopsAtTheFirstNonReceiptSubTag() {
        val exact = line(1, "Y".repeat(999 - 28))
        assertEquals(999, exact.length)
        val reply = field("001", "101") + "010999" + exact + "013003000" + "007016" + "5167940000123315" + "!"
        assertEquals(9 + 6 + 999, TlvFraming.fieldEnd(reply, 9))
        val masked = PanMasker.maskReply(reply)
        assertTrue(masked.contains("007016516794******3315"))
        assertTrue(masked.contains("013003000"))
    }

    @Test
    fun everyDpSubTagValueAndTheRestAreMasked() {
        val pan = "5167940000123315"
        val dp = field("030", pan) + field("031", "S") + field("034", "REF $pan") + "*" + "TEXTE $pan"
        val reply = head + field("010", dp) + "!"
        val masked = PanMasker.maskReply(reply)
        assertFalse(masked.contains(pan))
        assertEquals(reply.length, masked.length)
    }

    @Test
    fun maskingFailsClosedWhenTheWalkBreaksBeforeACardNumber() {
        for (broken in listOf(
            head + "XYZ" + "5167940000123315",
            (head + field("016", "CLIENT 5167940000123315 XYZ")).dropLast(3),
            head + "010050" + line(1, "CARTE 5167940000123315"),
            head + "010999" + line(1, "A") + "*" + "CARTE 5167940000123315",
        )) {
            val masked = PanMasker.maskReply(broken)
            assertFalse(broken, masked.contains("5167940000123315"))
            assertTrue(broken, masked.contains("516794******3315"))
            assertEquals(broken.length, masked.length)
        }
    }

    @Test
    fun onlyAsciiDigitsAndNeverThrows() {
        assertEquals(-1, TlvFraming.fieldEnd("٠٠١003101", 0))
        assertEquals(-1, TlvFraming.fieldEnd("001００１1", 0))
        assertEquals(-1, TlvFraming.fieldEnd("001-01X", 0))
        for (bad in listOf("٠٠١003101", "001-01X", "010999?", "", "!", "010999030٠01")) {
            TlvFraming.isCompleteMessage(bad)
            PanMasker.maskReply(bad)
        }
    }
}
