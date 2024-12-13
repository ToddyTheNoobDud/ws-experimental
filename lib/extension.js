'use strict';
const { tokenChars } = require('./validation');

const push = (dest, name, elem) => {
  (dest[name] || (dest[name] = [])).push(elem);
};

const parse = (header) => {
  const offers = Object.create(null);
  let params = Object.create(null);
  let name = '';
  let paramName = '';
  let value = '';
  let inQuotes = false;
  let isEscaping = false;

  for (let i = 0; i < header.length; i++) {
    const code = header.charCodeAt(i);

    if (name === '') {
      if (tokenChars[code] === 1) {
        name += header[i];
      } else if (code === 0x3b || code === 0x2c) {
        push(offers, name, params);
        params = Object.create(null);
        name = '';
        if (code === 0x2c) continue;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}: ${header[i]}`);
      }
    } else if (paramName === '') {
      if (tokenChars[code] === 1) {
        paramName += header[i];
      } else if (code === 0x3d) {
        value = '';
      } else if (code === 0x3b || code === 0x2c) {
        push(params, paramName, value);
        paramName = '';
        value = '';
        if (code === 0x2c) continue;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}: ${header[i]}`);
      }
    } else {
      if (code === 0x22 && !isEscaping) {
        inQuotes = !inQuotes;
      } else if (code === 0x5c && !inQuotes) {
        isEscaping = true;
      } else if (inQuotes && isEscaping) {
        value += header[i];
        isEscaping = false;
      } else if (inQuotes) {
        value += header[i];
      } else if (code === 0x3b || code === 0x2c) {
        push(params, paramName, value);
        paramName = '';
        value = '';
        if (code === 0x2c) continue;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}: ${header[i]}`);
      }
    }
  }

  if (name !== '') push(offers, name, params);
  return offers;
};

const format = (extensions) => {
  const result = [];

  for (const extension of Object.keys(extensions)) {
    const configurations = extensions[extension];
    const configurationArray = Array.isArray(configurations) ? configurations : [configurations];

    for (const params of configurationArray) {
      const paramArray = [];

      for (const k of Object.keys(params)) {
        const values = params[k];
        const valueArray = Array.isArray(values) ? values : [values];
        const formattedValues = valueArray.map(v => (v === true ? k : `${k}=${v}`));
        paramArray.push(formattedValues.join('; '));
      }

      result.push(`${extension}; ${paramArray.join('; ')}`);
    }
  }

  return result.join(', ');
};

module.exports = { format, parse };
