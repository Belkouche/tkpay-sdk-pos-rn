/**
 * Node-only stand-in for the TkpayNaps native module, so the SDK can run
 * outside React Native (quickstart, integration tests against the emulator).
 *
 * Same semantics as the Android/iOS modules: sendPaymentRequest opens a new
 * TCP connection and keeps it open; sendConfirmation reuses it, then closes
 * it. A response ends at the '!' / '?' terminator or after 1 s of silence, and
 * is decoded as UTF-8 like the native modules.
 *
 * Requiring this file installs it as `react-native` and stubs `fetch`, so the
 * fire-and-forget gateway notification is not sent from a Node run.
 */

const net = require('net');
const Module = require('module');

let socket = null;
const sent = [];

function readFrame(s, timeout) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let silence = null;
    const done = (value, error) => {
      clearTimeout(timer);
      clearTimeout(silence);
      s.removeAllListeners('data');
      s.removeAllListeners('error');
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => done(null, new Error('Timeout waiting for response')), timeout);
    const text = () => Buffer.concat(chunks).toString('utf8');
    s.on('data', (chunk) => {
      chunks.push(chunk);
      clearTimeout(silence);
      const last = chunk[chunk.length - 1];
      if (last === 0x21 || last === 0x3f) return done(text().slice(0, -1)); // '!' / '?'
      silence = setTimeout(() => done(text()), 1000);
    });
    s.on('error', (e) => done(null, e));
  });
}

function closeSocket() {
  if (socket) socket.destroy();
  socket = null;
}

const TkpayNaps = {
  async sendPaymentRequest(host, port, tlv, timeout) {
    closeSocket();
    socket = net.connect(port, host);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    // Like the native modules, the connection stays open for a possible Phase 2;
    // unref it so an unused one (e.g. after a decline) does not keep Node alive.
    socket.unref();
    sent.push(tlv);
    socket.write(tlv, 'utf8');
    try {
      return await readFrame(socket, timeout);
    } catch (e) {
      closeSocket();
      throw e;
    }
  },
  async sendConfirmation(tlv, timeout) {
    if (!socket) throw new Error('No active connection');
    if (tlv) {
      sent.push(tlv);
      socket.write(tlv, 'utf8');
    }
    try {
      return await readFrame(socket, timeout);
    } finally {
      closeSocket();
    }
  },
  async testConnection(host, port, timeout) {
    return new Promise((resolve) => {
      const s = net.connect(port, host);
      const end = (ok) => {
        s.destroy();
        resolve(ok);
      };
      s.setTimeout(timeout, () => end(false));
      s.once('connect', () => end(true));
      s.once('error', () => end(false));
    });
  },
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'react-native') {
    return { NativeModules: { TkpayNaps }, Platform: { OS: 'android' } };
  }
  return originalLoad.call(this, request, ...rest);
};
global.fetch = async () => ({ ok: true });

module.exports = { sent, closeSocket };
