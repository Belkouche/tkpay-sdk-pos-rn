// Runs the shared vectors in test-fixtures/pan-vectors.json against ios/PanMasker.swift,
// and the reply framing checks against ios/TlvFraming.swift.
// Build and run: npm run test:native:ios
import Foundation

var failures = 0
func check(_ ok: Bool, _ message: @autoclosure () -> String) {
    if !ok { failures += 1; print("FAIL: \(message())") }
}

let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "test-fixtures/pan-vectors.json"
let data = try Data(contentsOf: URL(fileURLWithPath: path))
let vectors = try JSONSerialization.jsonObject(with: data) as! [String: Any]

let text = vectors["text"] as! [[String: String]]
for v in text {
    let out = PanMasker.maskText(v["input"]!)
    check(out == v["expected"]!, "text \(v["input"]!.debugDescription) -> \(out.debugDescription), expected \(v["expected"]!.debugDescription)")
}

let replies = vectors["nativeReply"] as! [[String: String]]
for v in replies {
    let out = PanMasker.maskReply(v["input"]!)
    check(out == v["expected"]!, "reply (\(v["note"]!)) -> \(out)")
    check(out.utf16.count == v["input"]!.utf16.count, "reply length changed (\(v["note"]!))")
}
let masked = PanMasker.maskReply(replies[0]["input"]!)
for pan in ["5167940000123315", "5167 9400 0012 3315", "6011000990139424127"] {
    check(!masked.contains(pan), "full PAN left in reply: \(pan)")
}
let noisy = "0070165167940000123315013003000!0070165167940000123315"
check(PanMasker.maskReply(noisy) == "007016516794******3315013003000!0070165167940000123315", "terminator handling")

// Framing (TlvFraming.swift): same rules as fieldEnd / isCompleteMessage in TlvProtocol.ts
func field(_ tag: String, _ value: String) -> String { tag + String(format: "%03d", value.utf16.count) + value }
func line(_ n: Int, _ text: String) -> String {
    field("030", String(format: "%02d", n)) + field("031", "S") + field("032", "G") + field("033", text)
}
var framingChecks = 0
func frameCheck(_ ok: Bool, _ message: String) { framingChecks += 1; check(ok, "framing: \(message)") }

let head = field("001", "101") + field("013", "000") + field("008", "000042")
let receipt = line(1, "TOTAL?") + "*" + line(2, "MERCI!") + "?"
let frame = head + field("010", receipt) + field("016", "CLIENT") + "!"
let cutQ = String(frame[..<frame.range(of: "TOTAL?")!.upperBound])
let cutB = String(frame[..<frame.range(of: "MERCI!")!.upperBound])
frameCheck(!TlvFraming.isCompleteMessage(cutQ), "read ending at a receipt line's '?' is not complete")
frameCheck(!TlvFraming.isCompleteMessage(cutB), "read ending at a '!' in a receipt line is not complete")
frameCheck(TlvFraming.isCompleteMessage(frame), "terminator at a field boundary ends the reply")
frameCheck(TlvFraming.isCompleteMessage(head + "?"), "v1 '?' at a boundary ends the reply")
frameCheck(!TlvFraming.isCompleteMessage(head), "no terminator: not complete")
frameCheck(TlvFraming.isCompleteMessage("HELLO!"), "not TLV: trailing terminator ends it")
frameCheck((try? TlvFraming.isReplyEnd(Data(cutQ.utf8))) == false, "isReplyEnd: receipt '?' is data")
frameCheck((try? TlvFraming.isReplyEnd(Data(frame.utf8))) == true, "isReplyEnd: complete reply")
frameCheck((try? TlvFraming.isReplyEnd(Data((head + "0").utf8))) == false, "isReplyEnd: walks only when data ends with '!' or '?'")
var tooLarge = false
do { _ = try TlvFraming.isReplyEnd(Data(repeating: 0x58, count: TlvFraming.maxResponseBytes + 1)) } catch is TlvFraming.ResponseTooLarge { tooLarge = true } catch {}
frameCheck(tooLarge, "64 KB cap throws ResponseTooLarge")

let longReceipt = (1...60).map { line($0, "LIGNE \($0) ..........") }.joined(separator: "*") + "?"
let dp999 = head + "010999" + longReceipt + field("016", "CLIENT") + "!"
let dp999Units = Array(dp999.utf16)
frameCheck(longReceipt.utf16.count > 999, "long receipt is over 999 chars")
frameCheck(TlvFraming.fieldEnd(dp999Units, head.utf16.count) == head.utf16.count + 6 + longReceipt.utf16.count, "DP declared 999 ends at its own '?'")
frameCheck(TlvFraming.isCompleteMessage(dp999), "DP declared 999: complete reply")
frameCheck(!TlvFraming.isCompleteMessage(String(dp999.prefix(head.count + 1500)) + "?"), "DP declared 999 not fully received")
let panInLongReceipt = head + "010999" + longReceipt.replacingOccurrences(of: "LIGNE 60 ..........", with: "5167940000123315...") + "!"
frameCheck(!PanMasker.maskReply(panInLongReceipt).contains("5167940000123315"), "PanMasker masks past 999 chars of a DP declared 999")

for bad in ["\u{0660}\u{0660}\u{0661}003101", "001\u{FF10}\u{FF10}\u{FF11}1", "001-01X", "010999?", "", "!"] {
    let units = Array(bad.utf16)
    frameCheck(units.count < 6 || TlvFraming.fieldEnd(units, 0) == -1 || bad == "010999?", "non-ASCII / signed length is not TLV: \(bad.debugDescription)")
    _ = TlvFraming.isCompleteMessage(bad)
    _ = PanMasker.maskReply(bad)
}

// DP declared 999, exactly 999 chars of sub-records and no '?': stops at the top-level 013
let exact999 = line(1, String(repeating: "Y", count: 999 - 28))
let guardFrame = field("001", "101") + "010999" + exact999 + "013003000" + "007016" + "5167940000123315" + "!"
frameCheck(exact999.utf16.count == 999, "999-char receipt")
frameCheck(TlvFraming.fieldEnd(Array(guardFrame.utf16), 9) == 9 + 6 + 999, "DP 999 without '?' ends at the declared length")
let guardMasked = PanMasker.maskReply(guardFrame)
frameCheck(guardMasked.contains("007016516794******3315"), "tag 007 after a 999-long DP is masked as its own field")
frameCheck(guardMasked.contains("013003000"), "CR after a 999-long DP kept as its own field")

// Every DP sub-tag value and the unparseable rest are masked, not only 033
let pan = "5167940000123315"
let anyTagDp = field("030", pan) + field("031", "S") + field("034", "REF \(pan)") + "*" + "TEXTE \(pan)"
let anyTagMasked = PanMasker.maskReply(head + field("010", anyTagDp) + "!")
frameCheck(!anyTagMasked.contains(pan), "PAN masked in every DP sub-tag value and the rest")
frameCheck(anyTagMasked.utf16.count == (head + field("010", anyTagDp) + "!").utf16.count, "masking keeps the length")

// Fail closed: a walk that breaks before a card number still masks it
let notTlv: String = head + "XYZ" + "5167940000123315"
let truncated: String = String((head + field("016", "CLIENT 5167940000123315 XYZ")).dropLast(3))
let brokenReplies: [String] = [
    notTlv,                                                              // not TLV
    truncated,                                                           // field longer than the reply
    head + "010050" + line(1, "CARTE 5167940000123315"),                  // DP declared longer than the reply
    head + "010999" + line(1, "A") + "*" + "CARTE 5167940000123315",     // DP 999 walk fails, no '?'
]
for broken in brokenReplies {
    let masked = PanMasker.maskReply(broken)
    frameCheck(!masked.contains("5167940000123315") && masked.contains("516794******3315"), "fail closed: \(broken.debugDescription) -> \(masked)")
    frameCheck(masked.utf16.count == broken.utf16.count, "fail closed keeps the length")
}

print("\(text.count) text + \(replies.count) reply vectors, \(framingChecks) framing checks, \(failures) failure(s)")
exit(failures == 0 ? 0 : 1)
