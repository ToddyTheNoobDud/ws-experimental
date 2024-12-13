'use strict';
const { isUtf8 } = require('buffer');
const { hasBlob } = require('./constants');

const tokenChars = Buffer.from([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0
]);

/**
 * Checks if a status code is allowed in a close frame.
 *
 * @param {Number} code The status code
 * @return {Boolean} `true` if the status code is valid, else `false`
 * @public
 */
function isValidStatusCode(code) {
  return (
    (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) ||
    (code >= 3000 && code <= 4999)
  );
}

/**
 * Checks if a given buffer contains only valid UTF-8.
 *
 * @param {Buffer} buf The buffer to check
 * @return {Boolean} `true` if `buf` contains only valid UTF-8, else `false`
 * @public
 */
function isValidUTF8(buf) {
  let i = 0;
  const length = buf.length;

  while (i < length) {
    const byte = buf[i];

    if ((byte & 0x80) === 0) {
      // 0xxxxxxx
      i++;
    } else if ((byte & 0xe0) === 0xc0) {
      // 110xxxxx 10xxxxxx
      if (i + 1 >= length || (buf[i + 1] & 0xc0) !== 0x80 || (byte & 0xfe) === 0xc0) {
        return false;
      }
      i += 2;
    } else if ((byte & 0xf0) === 0xe0) {
      // 1110xxxx 10xxxxxx 10xxxxxx
      if (i + 2 >= length || (buf[i + 1] & 0xc0) !== 0x80 || (buf[i + 2] & 0xc0) !== 0x80 ||
          (byte === 0xe0 && (buf[i + 1] & 0xe0) === 0x80) ||
          (byte === 0xed && (buf[i + 1] & 0xe0) === 0xa0)) {
        return false;
      }
      i += 3;
    } else if ((byte & 0xf8) === 0xf0) {
      // 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
      if (i + 3 >= length || (buf[i + 1] & 0xc0) !== 0x80 || (buf[i + 2] & 0xc0) !== 0x80 ||
          (buf[i + 3] & 0xc0) !== 0x80 ||
          (byte === 0xf0 && (buf[i + 1] & 0xf0) === 0x80) ||
          (byte === 0xf4 && buf[i + 1] > 0x8f) || byte > 0xf4) {
        return false;
      }
      i += 4;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Determines whether a value is a `Blob`.
 *
 * @param {*} value The value to be tested
 * @return {Boolean} `true` if `value` is a `Blob`, else `false`
 * @private
 */
function isBlob(value) {
  return (
    hasBlob &&
    typeof value === 'object' &&
    typeof value.arrayBuffer === 'function' &&
    typeof value.type === 'string' &&
    typeof value.stream === 'function' &&
    (value[Symbol.toStringTag] === 'Blob' || value[Symbol.toStringTag] === 'File')
  );
}

module.exports = {
  isBlob,
  isValidStatusCode,
  isValidUTF8,
  tokenChars
};

// Conditional UTF-8 validation
if (isUtf8) {
  module.exports.isValidUTF8 = function (buf) {
    return buf.length < 24 ? isValidUTF8(buf) : isUtf8(buf);
} } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
  try {
    const utf8Validate = require('utf-8-validate');
    module.exports.isValidUTF8 = function (buf) {
      return buf.length < 32 ? isValidUTF8(buf) : utf8Validate(buf);
    };
  } catch (e) {
    // Continue regardless of the error.
  }
} 
