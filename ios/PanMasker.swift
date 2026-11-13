import Foundation

/// Masks card numbers in a raw terminal reply before it crosses the bridge to JS.
///
/// - Tag 007 (NCAR): every digit except the first 6 and last 4 becomes '*'.
/// - Tag 010 (DP): in every sub-tag value (and any unparseable rest), every card-shaped run is
///   masked the same way. A card-shaped run is 13+ digits where consecutive
///   digits are adjacent or separated by exactly one space, dash, dot, tab or
///   non-breaking space; runs over 19 digits are masked too.
///
/// If the field walk breaks (not TLV, or a field longer than the reply), every
/// card-shaped run in the rest of the reply is masked (fail closed).
///
/// Digits are replaced one for one, so the reply length, every TLV length and
/// the receipt layout stay unchanged. Works on UTF-16 code units, like the JS
/// layer (TlvProtocol.ts) and the Android PanMasker.
enum PanMasker {
    private static let star = UInt16(UInt8(ascii: "*"))
    private static let minRunDigits = 13

    static func maskReply(_ reply: String) -> String {
        var units = Array(reply.utf16)
        var i = 0
        var previousValueStart = 0
        while i + 6 <= units.count {
            if units[i] == UInt16(UInt8(ascii: "!")) || units[i] == UInt16(UInt8(ascii: "?")) { break }
            // Same field walk as the reader: a DP declared 999 runs to its own '?'
            let end = TlvFraming.fieldEnd(units, i)
            guard end >= 0, end <= units.count, let tag = number(units, i, 3) else {
                // Fail closed: the walk broke. Mask every card-shaped run in the whole rest in one
                // pass first, from the previous field's value (lengths are untrusted: a number may
                // straddle a declared end), then the receipt sub-tag values of a DP up to
                // min(declared end, reply length).
                maskRuns(&units, previousValueStart, units.count)
                if TlvFraming.number(units, i, 3) == 10, let length = TlvFraming.number(units, i + 3, 3) {
                    maskReceiptBlock(&units, i + 6, min(i + 6 + length, units.count))
                }
                break
            }
            let start = i + 6
            if tag == 7 {
                maskDigits(&units, start, end)
            } else if tag == 10 {
                maskReceiptBlock(&units, start, end)
            }
            previousValueStart = start
            i = end
        }
        return String(decoding: units, as: UTF16.self)
    }

    /// Masks card-shaped runs in free text.
    static func maskText(_ text: String) -> String {
        var units = Array(text.utf16)
        maskRuns(&units, 0, units.count)
        return String(decoding: units, as: UTF16.self)
    }

    private static func maskReceiptBlock(_ units: inout [UInt16], _ start: Int, _ end: Int) {
        var i = start
        while i < end {
            if units[i] == star || units[i] == UInt16(UInt8(ascii: "?")) {
                i += 1
                continue
            }
            guard i + 6 <= end, let length = number(units, i + 3, 3), i + 6 + length <= end else {
                // Not a sub-tag: mask what is left as plain text
                maskRuns(&units, i, end)
                return
            }
            maskRuns(&units, i + 6, i + 6 + length)
            i += 6 + length
        }
    }

    /// Value of `count` ASCII digits at `start`, or nil if any is not a digit.
    private static func number(_ units: [UInt16], _ start: Int, _ count: Int) -> Int? {
        var value = 0
        for k in start..<(start + count) {
            guard isDigit(units[k]) else { return nil }
            value = value * 10 + Int(units[k] - 0x30)
        }
        return value
    }

    private static func isDigit(_ u: UInt16) -> Bool { u >= 0x30 && u <= 0x39 }

    private static func isSeparator(_ u: UInt16) -> Bool {
        u == 0x20 || u == 0x2D || u == 0x2E || u == 0x09 || u == 0xA0 // space - . tab NBSP
    }

    /// Finds each card-shaped run in [start, end) and masks it.
    private static func maskRuns(_ units: inout [UInt16], _ start: Int, _ end: Int) {
        var i = start
        while i < end {
            guard isDigit(units[i]) else {
                i += 1
                continue
            }
            var runEnd = i + 1
            var digits = 1
            while true {
                if runEnd < end && isDigit(units[runEnd]) {
                    runEnd += 1
                    digits += 1
                } else if runEnd + 1 < end && isSeparator(units[runEnd]) && isDigit(units[runEnd + 1]) {
                    runEnd += 2
                    digits += 1
                } else {
                    break
                }
            }
            if digits >= minRunDigits { maskDigits(&units, i, runEnd) }
            i = runEnd
        }
    }

    /// Replaces every digit in [start, end) except the first 6 and last 4 with '*'.
    private static func maskDigits(_ units: inout [UInt16], _ start: Int, _ end: Int) {
        let digitCount = units[start..<end].filter(isDigit).count
        if digitCount < 10 { return }
        var index = 0
        for k in start..<end where isDigit(units[k]) {
            if index >= 6 && index < digitCount - 4 { units[k] = star }
            index += 1
        }
    }
}
