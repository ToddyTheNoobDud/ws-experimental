'use strict';
const { Duplex } = require('stream');

const createWebSocketStream = (ws, options = {}) => {
  const duplex = new Duplex({
    ...options,
    autoDestroy: true, // Automatically destroy on error
    emitClose: true, // Emit close event
    objectMode: false,
    writableObjectMode: false,
  });

  const handleMessage = (msg, isBinary) => {
    const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
    if (!duplex.push(data)) {
      ws.pause(); // Pause WebSocket if the stream is not ready to receive more data
    }
  };

  const handleError = (err) => {
    if (!duplex.destroyed) {
      duplex.destroy(err);
    }
  };

  const handleClose = () => {
    if (!duplex.destroyed) {
      duplex.push(null); // Signal the end of the stream
    }
  };

  // Set up WebSocket event listeners
  ws.on('message', handleMessage);
  ws.once('error', handleError);
  ws.once('close', handleClose);

  duplex._destroy = (err, callback) => {
    if (ws.readyState === ws.CLOSED) {
      callback(err);
      return process.nextTick(() => duplex.emit('close')); // Emit close event asynchronously
    }

    const onOpen = () => duplex._destroy(err, callback);
    const onClose = () => {
      callback(err);
      process.nextTick(() => duplex.emit('close'));
    };

    if (ws.readyState === ws.CONNECTING) {
      ws.once('open', onOpen);
      return;
    }

    if (ws._socket) {
      if (ws._socket._writableState.finished) {
        callback(err);
        if (duplex._readableState.endEmitted) {
          duplex.destroy();
        }
      } else {
        ws._socket.once('finish', onClose);
      }
      ws.close(); // Close WebSocket connection
    }
  };

  duplex._final = (callback) => {
    if (ws.readyState === ws.CONNECTING) {
      ws.once('open', () => duplex._final(callback));
      return;
    }

    if (ws._socket && !ws._socket._writableState.finished) {
      ws._socket.once('finish', callback);
      ws.close(); // Close WebSocket connection
    } else {
      callback();
    }
  };

  duplex._read = () => {
    if (ws.isPaused) {
      ws.resume(); // Resume WebSocket if paused
    }
  };

  duplex._write = (chunk, encoding, callback) => {
    if (ws.readyState === ws.CONNECTING) {
      ws.once('open', () => duplex._write(chunk, encoding, callback));
      return;
    }
    ws.send(chunk, callback); // Send data over WebSocket
  };

  return duplex; // Return the duplex stream
};

module.exports = createWebSocketStream;
