package ma.tkpay.naps

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/** Runs the shared vectors in test-fixtures/pan-vectors.json (same file as the JS and Swift tests). */
class PanMaskerTest {
    private val vectors: JsonObject by lazy {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        while (dir != null && !File(dir, "test-fixtures/pan-vectors.json").exists()) dir = dir.parentFile
        requireNotNull(dir) { "test-fixtures/pan-vectors.json not found above ${System.getProperty("user.dir")}" }
        JsonParser.parseString(File(dir, "test-fixtures/pan-vectors.json").readText()).asJsonObject
    }

    @Test
    fun textVectors() {
        for (v in vectors.getAsJsonArray("text")) {
            val input = v.asJsonObject["input"].asString
            assertEquals(input, v.asJsonObject["expected"].asString, PanMasker.maskText(input))
        }
    }

    @Test
    fun replyVectorsMaskInPlaceAndKeepLengths() {
        for (v in vectors.getAsJsonArray("nativeReply")) {
            val input = v.asJsonObject["input"].asString
            val masked = PanMasker.maskReply(input)
            assertEquals(v.asJsonObject["note"].asString, v.asJsonObject["expected"].asString, masked)
            assertEquals(input.length, masked.length)
        }
    }

    @Test
    fun noFullPanLeftInReply() {
        val masked = PanMasker.maskReply(vectors.getAsJsonArray("nativeReply")[0].asJsonObject["input"].asString)
        for (pan in listOf("5167940000123315", "5167 9400 0012 3315", "6011000990139424127")) {
            assertFalse(pan, masked.contains(pan))
        }
    }

    @Test
    fun stopsAtTerminatorAndIgnoresNoise() {
        val reply = "0070165167940000123315013003000!0070165167940000123315"
        assertEquals("007016516794******3315013003000!0070165167940000123315", PanMasker.maskReply(reply))
    }
}
