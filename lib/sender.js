/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^Duplex" }] */

'use strict';

const { Duplex } = require('stream');
const { randomFillSync } = require('crypto');

const PerMessageDeflate = require('./permessage-deflate');
const { EMPTY_BUFFER, kWebSocket, NOOP } = require('./constants');
const { isBlob, isValidStatusCode } = require('./validation');
const { mask: applyMask, toBuffer } = require('./buffer-util');

const kByteLength = Symbol('kByteLength');
const maskBuffer = Buffer.alloc(4);
const RANDOM_POOL_SIZE = 8 * 1024;
let randomPool;
let randomPoolPointer = RANDOM_POOL_SIZE;

const DEFAULT = 0;
const DEFLATING = 1;
const GET_BLOB_DATA = 2;

/**
 * HyBi Sender implementation.
 */
class Sender {
  /**
   * Creates a Sender instance.
   *
   * @param {Duplex} socket The connection socket
   * @param {Object} [extensions] An object containing the negotiated extensions
   * @param {Function} [generateMask] The function used to generate the masking
   *     key
   */
  constructor(socket, extensions, generateMask) {
    this._extensions = extensions || {};

    if (generateMask) {
      this._generateMask = generateMask;
      this._maskBuffer = Buffer.alloc(4);
    }

    this._socket = socket;

    this._firstFragment = true;
    this._compress = false;

    this._bufferedBytes = 0;
    this._queue = [];
    this._state = DEFAULT;
    this.onerror = NOOP;
    this[kWebSocket] = undefined;
  }

  /**
   * Frames a piece of data according to the HyBi WebSocket protocol.
   *
   * @param {(Buffer|String)} data The data to frame
   * @param {Object} options Options object
   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
   *     FIN bit
   * @param {Function} [options.generateMask] The function used to generate the
   *     masking key
   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
   *     `data`
   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
   *     key
   * @param {Number} options.opcode The opcode
   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
   *     modified
   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
   *     RSV1 bit
   * @return {(Buffer|String)[]} The framed data
   * @public
   */
  static frame(data, options) {
    let mask;
    let merge = false;
    let offset = 2;
    let skipMasking = false;

    if (options.mask) {
        mask = options.maskBuffer || maskBuffer;
        if (options.generateMask) {
            options.generateMask(mask);
        } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
                if (!randomPool) {
                    randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
                }
                randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
                randomPoolPointer = 0;
            }
            for (let i = 0; i < 4; i++) {
                mask[i] = randomPool[randomPoolPointer++];
            }
            skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
            offset = 6;
        }
    }

    let dataLength;
    if (typeof data === 'string') {
        data = Buffer.from(data);
        dataLength = data.length;
    } else {
        dataLength = data.length;
    }

    let payloadLength = dataLength;
    if (dataLength >= 65536) {
        offset += 8; 
        payloadLength = 127;
    } else if (dataLength > 125) {
        offset += 2; 
        payloadLength = 126;
    }

    // Allocate target buffer
    const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
    target[0] = options.fin ? options.opcode | 0x80 : options.opcode;
    if (options.rsv1) target[0] |= 0x40;
    target[1] = payloadLength;

    // Write data length
    if (payloadLength === 126) {
        target.writeUInt16BE(dataLength, 2);
    } else if (payloadLength === 127) {
        target.fill(0, 2, 10); 
        target.writeUIntBE(dataLength, 2, 8); 
    }

    if (options.mask) {
        target[1] |= 0x80; 
        target.set(mask, offset - 4);
        if (!skipMasking) {
            applyMask(data, mask, data, 0, dataLength); 
        }
    }

    return [target, data];
}

  close(code, data, mask, cb) {
    let buf;

    if (code === undefined) {
      buf = EMPTY_BUFFER;
    } else if (typeof code !== 'number' || !isValidStatusCode(code)) {
      throw new TypeError('First argument must be a valid error code number');
    } else {
      const length = Buffer.byteLength(data || '');
      if (length > 123) {
        throw new RangeError('The message must not be greater than 123 bytes');
      }
      buf = Buffer.allocUnsafe(2 + length);
      buf.writeUInt16BE(code, 0);
      if (data) {
        if (typeof data === 'string') {
          buf.write(data, 2);
        } else {
          data.copy(buf, 2);
        }
      }
    }

    const options = {
      [kByteLength]: buf.length,
      fin: true,
      generateMask: this._generateMask,
      mask,
      maskBuffer: this._maskBuffer,
      opcode: 0x08,
      readOnly: false,
      rsv1: false
    };

    this._state !== DEFAULT ? this.enqueue([this.dispatch, buf, false, options, cb]) : this.sendFrame(Sender.frame(buf, options), cb);
  }

  ping(data, mask, cb) {
    this.sendControlFrame(data, 0x09, mask, cb);
  }

  pong(data, mask, cb) {
    this.sendControlFrame(data, 0x0A, mask, cb);
  }

  sendControlFrame(data, opcode, mask, cb) {
    let byteLength = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
    if (byteLength > 125) {
      throw new RangeError('The data size must not be greater than 125 bytes');
    }

    const options = {
      [kByteLength]: byteLength,
      fin: true,
      generateMask: this._generateMask,
      mask,
      maskBuffer: this._maskBuffer,
      opcode,
      readOnly: false,
      rsv1: false
    };

    if (Buffer.isBuffer(data)) {
      this._state !== DEFAULT ? this.enqueue([this.dispatch, data, false, options, cb]) : this.sendFrame(Sender.frame(data, options), cb);
    } else {
      const bufferData = Buffer.from(data);
      this._state !== DEFAULT ? this.enqueue([this.dispatch, bufferData, false, options, cb]) : this.sendFrame(Sender.frame(bufferData, options), cb);
    }
  }

  /**
   * Sends a data message to the other peer.
   *
   * @param {*} data The message to send
   * @param {Object} options Options object
   * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
   *     or text
   * @param {Boolean} [options.compress=false] Specifies whether or not to
   *     compress `data`
   * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
   *     last one
   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
   *     `data`
   * @param {Function} [cb] Callback
   * @public
   */
  send(data, options, cb) {
    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
    let opcode = options.binary ? 2 : 1;
    let rsv1 = options.compress;
    let byteLength;
    let readOnly;

    if (typeof data === 'string') {
      byteLength = Buffer.byteLength(data);
      readOnly = false;
    } else if (isBlob(data)) {
      byteLength = data.size;
      readOnly = false;
    } else {
      data = toBuffer(data);
      byteLength = data.length;
      readOnly = toBuffer.readOnly;
    }

    if (this._firstFragment) {
      this._firstFragment = false;
      if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? 'server_no_context_takeover' : 'client_no_context_takeover']) {
        rsv1 = byteLength >= perMessageDeflate._threshold;
      }
      this._compress = rsv1;
    } else {
      rsv1 = false;
      opcode = 0;
    }

    if (options.fin) this._firstFragment = true;

    const opts = {
      [kByteLength]: byteLength,
      fin: options.fin,
      generateMask: this._generateMask,
      mask: options.mask,
      maskBuffer: this._maskBuffer,
      opcode,
      readOnly,
      rsv1,
    };

    if (isBlob(data)) {
      this._state !== DEFAULT ? this.enqueue([this.getBlobData, data, this._compress, opts, cb]) : this.getBlobData(data, this._compress, opts, cb);
    } else {
      this._state !== DEFAULT ? this.enqueue([this.dispatch, data, this._compress, opts, cb]) : this.dispatch(data, this._compress, opts, cb);
    }
  }

  getBlobData(blob, compress, options, cb) {
    this._bufferedBytes += options[kByteLength];
    this._state = GET_BLOB_DATA;

    blob.arrayBuffer()
      .then((arrayBuffer) => {
        if (this._socket.destroyed) {
          const err = new Error('The socket was closed while the blob was being read');
          process.nextTick(callCallbacks, this, err, cb);
          return;
        }

        this._bufferedBytes -= options[kByteLength];
        const data = toBuffer(arrayBuffer);
        if (!compress) {
          this._state = DEFAULT;
          this.sendFrame(Sender.frame(data, options), cb);
          this.dequeue();
        } else {
          this.dispatch(data, compress, options, cb);
        }
      })
      .catch((err) => {
        process.nextTick(onError, this, err, cb);
      });
  }

  dispatch(data, compress, options, cb) {
    if (!compress) {
      this.sendFrame(Sender.frame(data, options), cb);
      return;
    }

    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
    this._bufferedBytes += options[kByteLength];
    this._state = DEFLATING;

    perMessageDeflate.compress(data, options.fin, (_, buf) => {
      if (this._socket.destroyed) {
        const err = new Error('The socket was closed while data was being compressed');
        callCallbacks(this, err, cb);
        return;
      }

      this._bufferedBytes -= options[kByteLength];
      this._state = DEFAULT;
      options.readOnly = false;
      this.sendFrame(Sender.frame(buf, options), cb);
      this.dequeue();
    });
  }

  dequeue() {
    while (this._state === DEFAULT && this._queue.length) {
      const params = this._queue.shift();
      this._bufferedBytes -= params[3][kByteLength];
      Reflect.apply(params[0], this, params.slice(1));
    }
  }

  enqueue(params) {
    this._bufferedBytes += params[3][kByteLength];
    this._queue.push(params);
  }

  sendFrame(list, cb) {
    if (list.length === 2) {
      this._socket.cork();
      this._socket.write(list[0]);
      this._socket.write(list[1], cb);
      this._socket.uncork();
    } else {
      this._socket.write(list[0], cb);
    }
  }
}

module.exports = Sender;

function callCallbacks(sender, err, cb) {
  if (typeof cb === 'function') cb(err);
  for (const params of sender._queue) {
    const callback = params[params.length - 1];
    if (typeof callback === 'function') callback(err);
  }
}

function onError(sender, err, cb) {
  callCallbacks(sender, err, cb);
  sender.onerror(err);
}
