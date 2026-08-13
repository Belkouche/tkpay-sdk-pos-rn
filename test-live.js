/**
 * Live terminal test — runs against a real NAPS Pay terminal over TCP.
 * Usage: node test-live.js <host> [port]
 *
 * Exercises:
 *   1. TCP connection
 *   2. Network test (TM=009)  — verifies '!' terminator fix
 *   3. Payment (TM=001 + TM=002) — 50 centimes (0.50 MAD)
 *   4. Cancellation (TM=003)  — verifies TAG 002 + MT=104 fix
 */

const net = require('net');

const HOST = process.argv[2] || '192.168.24.77';
const PORT = parseInt(process.argv[3] || '4444', 10);

// ── TLV helpers ────────────────────────────────────────────────────────────────

function buildField(tag, value) {
  return `${tag}${String(value.length).padStart(3, '0')}${value}`;
}

function now() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const date = `${pad(d.getDate())}${pad(d.getMonth() + 1)}${d.getFullYear()}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return { date, time };
}

function seq(n) { return String(n).padStart(6, '0'); }

function buildNetworkTest(ncai, sequence) {
  const { date, time } = now();
  return buildField('001', '009') + buildField('003', ncai) +
         buildField('004', sequence) +
         buildField('014', date)  + buildField('015', time);
}

function buildPayment(amountCentimes, ncai, sequence) {
  const { date, time } = now();
  return buildField('001', '001') + buildField('002', String(amountCentimes)) +
         buildField('003', ncai)  + buildField('004', sequence) +
         buildField('012', '504') + buildField('014', date) + buildField('015', time);
}

function buildConfirmation(stan, ncai, sequence) {
  const { date, time } = now();
  return buildField('001', '002') + buildField('008', stan) +
         buildField('003', ncai)  + buildField('004', sequence) +
         buildField('014', date)  + buildField('015', time);
}

function buildDuplicate(ncai, sequence, stan) {
  const { date, time } = now();
  let msg = buildField('001', '008') + buildField('003', ncai) +
            buildField('004', sequence);
  if (stan) msg += buildField('008', stan);
  msg += buildField('014', date) + buildField('015', time);
  return msg;
}

function buildSettlement(ncai, sequence) {
  const { date, time } = now();
  return buildField('001', '010') + buildField('003', ncai) +
         buildField('004', sequence) +
         buildField('014', date) + buildField('015', time);
}

function buildReset(ncai, sequence) {
  const { date, time } = now();
  return buildField('001', '012') + buildField('003', ncai) +
         buildField('004', sequence) +
         buildField('014', date) + buildField('015', time);
}

function buildReferencing(ncai, sequence) {
  const { date, time } = now();
  return buildField('001', '013') + buildField('003', ncai) +
         buildField('004', sequence) +
         buildField('014', date) + buildField('015', time);
}

function buildCancellationConfirmation(stan, ncai, sequence) {
  const { date, time } = now();
  return buildField('001', '004') + buildField('008', stan) +
         buildField('003', ncai)  + buildField('004', sequence) +
         buildField('014', date)  + buildField('015', time);
}

function buildCancellation(stan, ncai, sequence, amountCentimes) {
  const { date, time } = now();
  let msg = buildField('001', '003');
  if (amountCentimes != null) msg += buildField('002', String(amountCentimes));
  msg += buildField('008', stan) + buildField('003', ncai) +
         buildField('005', sequence) + buildField('014', date) + buildField('015', time);
  return msg;
}

function parseTlv(s) {
  const fields = {};
  let i = 0;
  while (i + 6 <= s.length) {
    const tag = s.slice(i, i + 3);
    const len = parseInt(s.slice(i + 3, i + 6), 10);
    if (isNaN(len) || i + 6 + len > s.length) break;
    fields[tag] = s.slice(i + 6, i + 6 + len);
    i += 6 + len;
  }
  return fields;
}

// ── TCP send/receive (honours '!' terminator) ─────────────────────────────────

function sendReceive(host, port, message, timeoutMs, reuseSocket) {
  return new Promise((resolve, reject) => {
    const socket = reuseSocket || new net.Socket();
    let buf = '';
    let settled = false;

    const done = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!reuseSocket) socket.removeAllListeners();
      if (err) {
        if (!reuseSocket) socket.destroy();
        reject(err);
      } else {
        resolve({ response: result, socket });
      }
    };

    const timer = setTimeout(() => done(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);

    const send = () => {
      socket.write(message, 'utf8');
    };

    socket.on('data', chunk => {
      buf += chunk.toString('utf8');
      if (buf.includes('!')) {
        const excl = buf.indexOf('!');
        done(null, buf.slice(0, excl));
      }
    });
    socket.on('error', err => done(err));
    socket.on('close', () => { if (!settled) done(new Error('Connection closed')); });

    if (reuseSocket) {
      send();
    } else {
      socket.connect(port, host, send);
    }
  });
}

// ── Test runner ───────────────────────────────────────────────────────────────

const NCAI     = '0100001';
const SEQUENCE = seq(1);
const AMOUNT   = 50; // centimes = 0.50 MAD

let passed = 0, failed = 0;

function ok(label, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

(async () => {
  console.log(`\nNAPS Pay live test → ${HOST}:${PORT}\n`);

  // ── 1. Network test ────────────────────────────────────────────────────────
  console.log('1. Network test (TM=009)');
  try {
    const { response, socket: s1 } = await sendReceive(HOST, PORT, buildNetworkTest(NCAI, SEQUENCE), 10000);
    const f = parseTlv(response);
    ok('Response received',    !!response);
    ok('Terminated by !',      true, 'reached parseTlv without timeout');
    ok('CR=000',               f['013'] === '000', `CR=${f['013']}`);
    ok('MT=109',               f['001'] === '109', `MT=${f['001']}`);
    s1.destroy();
  } catch (e) {
    console.log(`  ❌ Network test failed: ${e.message}`);
    failed += 4;
  }

  // ── 2. Payment ─────────────────────────────────────────────────────────────
  console.log('\n2. Payment (TM=001 → TM=002) — 0.50 MAD');
  let paymentStan = null;
  try {
    // Phase 1
    const { response: r1, socket: s2 } = await sendReceive(
      HOST, PORT, buildPayment(AMOUNT, NCAI, SEQUENCE), 120000
    );
    const f1 = parseTlv(r1);
    ok('Phase-1 response',    !!r1);
    ok('CR=000',              f1['013'] === '000', `CR=${f1['013']}`);
    paymentStan = f1['008'];
    ok('STAN present',        !!paymentStan, `STAN=${paymentStan}`);

    if (f1['013'] === '000' && paymentStan) {
      // Phase 2 — same socket
      const { response: r2, socket: s3 } = await sendReceive(
        HOST, PORT, buildConfirmation(paymentStan, NCAI, SEQUENCE), 40000, s2
      );
      const f2 = parseTlv(r2);
      ok('Phase-2 response',  !!r2);
      ok('Phase-2 CR=000',    f2['013'] === '000', `CR=${f2['013']}`);
      s3.destroy();
    } else {
      s2.destroy();
      console.log('  ⚠️  Skipping Phase-2 (Phase-1 not approved)');
    }
  } catch (e) {
    console.log(`  ❌ Payment failed: ${e.message}`);
    failed += 5;
  }

  // ── 3. Two-phase Cancellation (TM=003 → TM=004) ───────────────────────────
  console.log('\n3. Cancellation (TM=003 → TM=004) — two-phase flow');
  if (!paymentStan) {
    console.log('  ⚠️  Skipped — no STAN from payment step');
  } else {
    try {
      // Phase 1 — send cancellation request, keep socket open
      const { response: rc1, socket: sc1 } = await sendReceive(
        HOST, PORT,
        buildCancellation(paymentStan, NCAI, SEQUENCE, AMOUNT),
        30000
      );
      const fc1 = parseTlv(rc1);
      ok('Phase-1 response',       !!rc1);
      ok('MT=103',                 fc1['001'] === '103', `MT=${fc1['001']}`);
      ok('CR=000',                 fc1['013'] === '000', `CR=${fc1['013']}`);

      if (fc1['001'] === '103' && fc1['013'] === '000') {
        // Phase 2 — send confirmation on same connection
        const { response: rc2, socket: sc2 } = await sendReceive(
          HOST, PORT,
          buildCancellationConfirmation(paymentStan, NCAI, SEQUENCE),
          30000, sc1
        );
        const fc2 = parseTlv(rc2);
        ok('Phase-2 response',     !!rc2);
        ok('MT=104',               fc2['001'] === '104', `MT=${fc2['001']}`);
        ok('Phase-2 CR=000',       fc2['013'] === '000', `CR=${fc2['013']}`);
        sc2.destroy();
        paymentStan = null; // consumed
      } else {
        sc1.destroy();
        console.log('  ⚠️  Phase-1 not approved — skipping Phase-2');
        if (fc1['001'] === '104') {
          // Terminal auto-confirmed (single-phase firmware)
          ok('Auto-confirm MT=104', true, 'terminal completed without TM=004');
          paymentStan = null;
        }
      }
    } catch (e) {
      console.log(`  ❌ Cancellation failed: ${e.message}`);
      failed += 6;
    }
  }

  // ── 4. Duplicate receipt (TM=008) ─────────────────────────────────────────
  console.log('\n4. Duplicate receipt (TM=008)');
  try {
    const { response, socket: s5 } = await sendReceive(
      HOST, PORT, buildDuplicate(NCAI, seq(2)), 15000
    );
    const f = parseTlv(response);
    ok('Response received',  !!response);
    ok('MT=108',             f['001'] === '108', `MT=${f['001']}`);
    ok('CR=000',             f['013'] === '000', `CR=${f['013']}`);
    s5.destroy();
  } catch (e) {
    console.log(`  ❌ Duplicate failed: ${e.message}`);
    failed += 3;
  }

  // ── 5. Settlement (TM=010) ────────────────────────────────────────────────
  console.log('\n5. Settlement (TM=010)');
  try {
    const { response, socket: s6 } = await sendReceive(
      HOST, PORT, buildSettlement(NCAI, seq(3)), 30000
    );
    const f = parseTlv(response);
    ok('Response received',  !!response);
    ok('MT=110',             f['001'] === '110', `MT=${f['001']}`);
    ok('CR=000',             f['013'] === '000', `CR=${f['013']}`);
    s6.destroy();
  } catch (e) {
    console.log(`  ❌ Settlement failed: ${e.message}`);
    failed += 3;
  }

  // ── 6. Reset (TM=012) ────────────────────────────────────────────────────
  console.log('\n6. Reset PinPAD (TM=012)');
  try {
    const { response, socket: s7 } = await sendReceive(
      HOST, PORT, buildReset(NCAI, seq(4)), 15000
    );
    const f = parseTlv(response);
    ok('Response received',  !!response);
    ok('MT=112',             f['001'] === '112', `MT=${f['001']}`);
    ok('CR=000',             f['013'] === '000', `CR=${f['013']}`);
    s7.destroy();
  } catch (e) {
    console.log(`  ❌ Reset failed: ${e.message}`);
    failed += 3;
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ''}`);
  process.exit(failed > 0 ? 1 : 0);
})();
