import { WebSocketServer, WebSocket } from 'ws';

export function createWebSocketHub(port) {
  const wss = new WebSocketServer({ port });

  const state = {
    browserSocket: null,
    changeQueue: [],
    undoStack: [],
    redoStack: [],
    listeners: new Map(), // event name -> Set of callbacks
  };

  wss.on('connection', (ws) => {
    state.browserSocket = ws;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleMessage(msg, state);
      } catch {}
    });

    ws.on('close', () => {
      if (state.browserSocket === ws) state.browserSocket = null;
    });
  });

  function handleMessage(msg, state) {
    switch (msg.type) {
      case 'change':
        state.changeQueue.push(msg.payload);
        state.undoStack.push(msg.payload);
        state.redoStack = [];
        emit('change', msg.payload);
        break;
      case 'batch':
        for (const change of msg.payload) {
          state.changeQueue.push(change);
          state.undoStack.push(change);
        }
        state.redoStack = [];
        emit('batch', msg.payload);
        break;
      case 'undo':
        emit('undo');
        break;
      case 'redo':
        emit('redo');
        break;
      case 'save':
        emit('save', state.changeQueue.splice(0));
        break;
    }
  }

  function emit(event, data) {
    const listeners = state.listeners.get(event);
    if (listeners) for (const cb of listeners) cb(data);
  }

  function sendToBrowser(msg) {
    if (state.browserSocket?.readyState === WebSocket.OPEN) {
      state.browserSocket.send(JSON.stringify(msg));
    }
  }

  return {
    on(event, cb) {
      if (!state.listeners.has(event)) state.listeners.set(event, new Set());
      state.listeners.get(event).add(cb);
    },
    sendToBrowser,
    getChangeQueue: () => [...state.changeQueue],
    getUndoStack: () => [...state.undoStack],
    clearQueue: () => { state.changeQueue.length = 0; },
    close: () => wss.close(),
  };
}
