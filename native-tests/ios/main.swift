// Runs the shared vectors in test-fixtures/pan-vectors.json against ios/PanMasker.swift.
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

print("\(text.count) text + \(replies.count) reply vectors, \(failures) failure(s)")
exit(failures == 0 ? 0 : 1)
