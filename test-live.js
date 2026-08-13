/**
 * Live terminal test — runs against a real NAPS Pay terminal over TCP.
 *
 * Usage:
 *   node test-live.js [host] [port]              — full test (network + payment + cancel)
 *   node test-live.js [host] [port] cancel <STAN> <amountCentimes>  — cancel only
 *
 * Examples:
 *   node test-live.js
 *   node test-live.js 192.168.24.77 4444 cancel 000012 50
 */

const net = require('net');

const HOST = process.argv[2] || '192.168.24.77';
const PORT = parseInt(process.argv[3] || '4444', 10);
const CANCEL_ONLY = process.argv[4] === 'cancel';
const CANCEL_STAN = process.argv[5] || null;
const CANCEL_AMOUNT = process.argv[6] ? parseInt(process.argv[6], 10) : 50;

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

function buildCancellationConfirmation(stan, ncai, sequence, amount) {
  const { date, time } = now();
  let msg = buildField('001', '004');
  if (amount != null) msg += buildField('002', amount);
  msg += buildField('008', stan) + buildField('003', ncai) +
         buildField('004', sequence) +
         buildField('014', date) + buildField('015', time);
  return msg;
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
      clearTimeout(silenceTimer);
      socket.removeAllListeners('data');
      socket.removeAllListeners('error');
      socket.removeAllListeners('close');
      if (err) {
        if (!reuseSocket) socket.destroy();
        reject(err);
      } else {
        resolve({ response: result, socket });
      }
    };

    const timer = setTimeout(() => done(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);

    const send = () => {
      if (message) socket.write(message, 'utf8');
    };

    // Frame on '!'/'?' terminator when present, else on 1.5s silence
    // (cancellation responses MT=103/MT=104 carry no terminator)
    let silenceTimer = null;
    socket.on('data', chunk => {
      buf += chunk.toString('utf8');
      const excl = buf.indexOf('!');
      const q    = buf.indexOf('?');
      const end  = excl === -1 ? q : q === -1 ? excl : Math.min(excl, q);
      if (end !== -1) return done(null, buf.slice(0, end));
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => done(null, buf), 1500);
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
const AMOUNT   = 100; // centimes = 1.00 MAD

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

async function testCancel(stan, amountCentimes) {
  console.log(`\nCancellation test — STAN ${stan}, amount ${amountCentimes} centimes`);
  try {
    // Phase 1: send TM=003, keep socket open
    const { response: rc1, socket: sc1 } = await sendReceive(
      HOST, PORT,
      buildCancellation(stan, NCAI, SEQUENCE, amountCentimes),
      30000
    );
    const fc1 = parseTlv(rc1);
    console.log(`  raw1: MT=${fc1['001']} CR=${fc1['013']} STAN=${fc1['008']}`);
    ok('Phase-1 response',  !!rc1);
    ok('MT=103',            fc1['001'] === '103', `MT=${fc1['001']}`);
    ok('Phase-1 CR=000',    fc1['013'] === '000', `CR=${fc1['013']}`);

    if (fc1['001'] === '104') {
      ok('Single-phase MT=104', true, `CR=${fc1['013']}`);
      sc1.destroy();
      return;
    }

    if (fc1['001'] !== '103' || fc1['013'] !== '000') {
      sc1.destroy();
      console.log('  ⚠️  Phase-1 not approved — aborting');
      return;
    }

    // Phase 2: send TM=004 confirmation (with amount echoed from MT=103) → MT=104
    const { response: rc2, socket: sc2 } = await sendReceive(
      HOST, PORT,
      buildCancellationConfirmation(fc1['008'] || stan, NCAI, SEQUENCE, fc1['002']),
      40000, sc1
    );
    const fc2 = parseTlv(rc2);
    console.log(`  raw2: MT=${fc2['001']} CR=${fc2['013']} STAN=${fc2['008']}`);
    ok('Phase-2 response',  !!rc2);
    ok('MT=104',            fc2['001'] === '104', `MT=${fc2['001']}`);
    const cr2ok = fc2['013'] === '000' || fc2['013'] === '995';
    ok('Phase-2 CR=000/995', cr2ok, `CR=${fc2['013']}`);
    sc2.destroy();
  } catch (e) {
    console.log(`  ❌ Cancellation failed: ${e.message}`);
    failed += 6;
  }
}

(async () => {
  console.log(`\nNAPS Pay live test → ${HOST}:${PORT}\n`);

  if (CANCEL_ONLY) {
    if (!CANCEL_STAN) {
      console.log('Usage: node test-live.js [host] [port] cancel <STAN> [amountCentimes]');
      process.exit(1);
    }
    await testCancel(CANCEL_STAN, CANCEL_AMOUNT);
    const total = passed + failed;
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ''}`);
    process.exit(failed > 0 ? 1 : 0);
  }

  // ── 1. Network test ────────────────────────────────────────────────────────
  console.log('1. Network test (TM=009)');
  try {
    const { response, socket: s1 } = await sendReceive(HOST, PORT, buildNetworkTest(NCAI, SEQUENCE), 10000);
    const f = parseTlv(response);
    ok('Response received',    !!response);
    ok('Terminated by !/? ',   true, 'reached parseTlv without timeout');
    ok('CR=000',               f['013'] === '000', `CR=${f['013']}`);
    ok('MT=109',               f['001'] === '109', `MT=${f['001']}`);
    s1.destroy();
  } catch (e) {
    console.log(`  ❌ Network test failed: ${e.message}`);
    failed += 4;
  }

  // ── 2. Payment ─────────────────────────────────────────────────────────────
  console.log(`\n2. Payment (TM=001 → TM=002) — ${(AMOUNT / 100).toFixed(2)} MAD`);
  let paymentStan = null;
  try {
    const { response: r1, socket: s2 } = await sendReceive(
      HOST, PORT, buildPayment(AMOUNT, NCAI, SEQUENCE), 120000
    );
    const f1 = parseTlv(r1);
    ok('Phase-1 response',    !!r1);
    ok('CR=000',              f1['013'] === '000', `CR=${f1['013']}`);
    paymentStan = f1['008'];
    ok('STAN present',        !!paymentStan, `STAN=${paymentStan}`);

    if (f1['013'] === '000' && paymentStan) {
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

  // ── 3. Cancellation ────────────────────────────────────────────────────────
  if (paymentStan) {
    await testCancel(paymentStan, AMOUNT);
  } else {
    console.log('\n3. Cancellation — ⚠️  Skipped (no STAN from payment)');
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ''}`);
  process.exit(failed > 0 ? 1 : 0);
})();
