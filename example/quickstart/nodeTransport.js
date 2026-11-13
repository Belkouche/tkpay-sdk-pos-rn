/**
 * Node-only stand-in for the TkpayNaps native module, so the SDK can run
 * outside React Native (quickstart, integration tests against the emulator).
 *
 * Same semantics as the Android/iOS modules: sendPaymentRequest opens a new
 * TCP connection and keeps it open; sendConfirmation reuses it, then closes
 * it. A response ends at a '!' / '?' terminator on a TLV field boundary
 * (isCompleteMessage) or after 1 s of silence, is capped at 64 KB, and is
 * decoded as UTF-8 like the native modules.
 *
 * Requiring this file installs it as `react-native`.
 */

const net = require('net');
const Module = require('module');
const path = require('path');
// Framing check from the compiled SDK (TlvProtocol has no react-native dependency)
const { isCompleteMessage, MAX_RESPONSE_CHARS } = require(path.join(__dirname, '..', '..', 'lib', 'TlvProtocol'));

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
    let size = 0;
    s.on('data', (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      clearTimeout(silence);
      if (size > MAX_RESPONSE_CHARS) {
        const error = new Error(`Response larger than ${MAX_RESPONSE_CHARS} bytes`);
        error.code = 'INVALID_RESPONSE';
        return done(null, error);
      }
      const last = chunk[chunk.length - 1];
      // '!' / '?' ends the reply only on a field boundary (not inside a receipt line)
      if ((last === 0x21 || last === 0x3f) && isCompleteMessage(text())) return done(text().slice(0, -1));
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
module.exports = { sent, closeSocket };
