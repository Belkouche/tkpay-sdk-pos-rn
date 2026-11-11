import Foundation

/// TLV framing shared by the reply reader (TkpayNaps.receiveResponse) and PanMasker.
/// Same rules as fieldEnd / isCompleteMessage in TlvProtocol.ts. Works on UTF-16 code units.
enum TlvFraming {
    /// Largest reply accepted (replies seen are ~2 KB).
    static let maxResponseBytes = 64 * 1024

    /// Reply larger than `maxResponseBytes`; rejected as INVALID_RESPONSE.
    struct ResponseTooLarge: LocalizedError {
        var errorDescription: String? { "Response larger than \(TlvFraming.maxResponseBytes) bytes" }
    }

    private static let bang: UInt16 = 0x21
    private static let question: UInt16 = 0x3F
    private static let star: UInt16 = 0x2A

    private static func isTerminator(_ u: UInt16) -> Bool { u == bang || u == question }

    /// Value of `count` ASCII digits at `start`, or nil if out of range or any is not '0'...'9'.
    static func number(_ units: [UInt16], _ start: Int, _ count: Int) -> Int? {
        guard start >= 0, start + count <= units.count else { return nil }
        var value = 0
        for k in start..<(start + count) {
            guard units[k] >= 0x30 && units[k] <= 0x39 else { return nil }
            value = value * 10 + Int(units[k] - 0x30)
        }
        return value
    }

    /// End index (exclusive) of the field starting at `pos`, or -1 if its header is not 3 + 3
    /// ASCII digits. Can be past `units.count` when the field is not fully received yet. A DP
    /// (010) declared 999 long ends at its own '?' end marker, found by walking its sub-records
    /// (receipt sub-tag 030-039 + 3-digit length + value) and '*' line separators; the value
    /// includes it. Any other sub-record ends the walk at the declared length.
    static func fieldEnd(_ units: [UInt16], _ pos: Int) -> Int {
        guard let tag = number(units, pos, 3), let length = number(units, pos + 3, 3) else { return -1 }
        let declaredEnd = pos + 6 + length
        guard tag == 10 && length == 999 else { return declaredEnd }
        var i = pos + 6
        while i < units.count {
            if units[i] == star {
                i += 1
                continue
            }
            if units[i] == question { return max(i + 1, declaredEnd) }
            if i + 6 > units.count { return units.count + 1 } // rest of the receipt not received yet
            // Only receipt sub-tags (030-039): anything else (e.g. a top-level 013 or 007 after
            // a DP that really is 999 long, with no '?') is not part of the DP.
            guard let subTag = number(units, i, 3), (30...39).contains(subTag),
                  let subLength = number(units, i + 3, 3) else { return declaredEnd }
            i += 6 + subLength
        }
        return units.count + 1
    }

    /// True once `units` hold a complete reply: walking the fields by their length lands on a
    /// '!' or '?'. A terminator inside a value (receipt lines end with '?') is data. If the
    /// data is not TLV, a trailing terminator ends it.
    static func isCompleteMessage(_ units: [UInt16]) -> Bool {
        var pos = 0
        while pos < units.count {
            if isTerminator(units[pos]) { return true }
            if pos + 6 > units.count { return false }
            let end = fieldEnd(units, pos)
            if end < 0 { return isTerminator(units[units.count - 1]) }
            pos = end
        }
        return false
    }

    static func isCompleteMessage(_ text: String) -> Bool { isCompleteMessage(Array(text.utf16)) }

    /// Reader check after each chunk: throws past `maxResponseBytes`, and walks the fields
    /// only when the data ends with '!' or '?'.
    static func isReplyEnd(_ data: Data) throws -> Bool {
        if data.count > maxResponseBytes { throw ResponseTooLarge() }
        guard let last = data.last, last == 0x21 || last == 0x3F else { return false }
        return isCompleteMessage(String(decoding: data, as: UTF8.self))
    }
}
