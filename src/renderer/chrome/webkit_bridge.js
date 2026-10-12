// WebKitGTK <-> MR Browser UI Bridge
(() => {
  const listeners = new Map();
  const callbacks = new Map();
  let callSeq = 0;

  window.api = {
    send: (channel, ...args) => {
      try {
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mrb) {
          window.webkit.messageHandlers.mrb.postMessage({ type: 'send', channel, args });
        }
      } catch (e) {
        console.error('[MRB Bridge Send Error]:', e);
      }
    },
    invoke: (channel, ...args) => {
      return new Promise((resolve, reject) => {
        const id = ++callSeq;
        callbacks.set(id, { resolve, reject });
        try {
          if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mrb) {
            window.webkit.messageHandlers.mrb.postMessage({ type: 'invoke', id, channel, args });
          } else {
            resolve(null);
          }
        } catch (e) {
          callbacks.delete(id);
          reject(e);
        }
      });
    },
    on: (channel, cb) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(cb);
    }
  };

  // WebKit native tomondan yuborilgan hodisalar (events)
  window.__mrbDispatch = (channel, ...args) => {
    const set = listeners.get(channel);
    if (set) {
      for (const cb of set) {
        try { cb(...args); } catch (e) { console.error(e); }
      }
    }
  };

  // WebKit invoke javoblari (replies)
  window.__mrbReply = (id, result, error) => {
    const cb = callbacks.get(id);
    if (cb) {
      callbacks.delete(id);
      if (error) cb.reject(new Error(error));
      else cb.resolve(result);
    }
  };
})();
