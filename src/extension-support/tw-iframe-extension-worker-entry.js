const context = require('./tw-extension-worker-context');

const jQuery = require('./tw-jquery-shim');
global.$ = jQuery;
global.jQuery = jQuery;

const id = window.__WRAPPED_IFRAME_ID__;

(function patchFileInputClick() {
  if (!window.HTMLInputElement || !window.parent) {
    return;
  }
  const iframeId = id;
  const handlers = {};

  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || data.vmIframeId !== iframeId || !data.cysoFileResult) return;
    const cb = handlers[data.requestId];
    if (cb) {
      delete handlers[data.requestId];
      cb(data.files || []);
    }
  });

  const origClick = window.HTMLInputElement.prototype.click;
  window.HTMLInputElement.prototype.click = function () {
    if (this.type !== 'file') {
      return origClick.apply(this, arguments);
    }
    const exts = (this.getAttribute('accept') || this.accept || '')
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.charAt(0) === '.')
      .map((p) => p.slice(1));
    const multiple = !!this.multiple;
    const requestId = 'cyso-' + Math.random().toString(36).slice(2);
    handlers[requestId] = (files) => {
      if (!files.length) return;
      const constructed = files.map((f) =>
        new File([f.data], f.name, f.type ? {type: f.type} : undefined));
      try {
        const dt = new DataTransfer();
        for (const f of constructed) dt.items.add(f);
        Object.defineProperty(this, 'files', {
          configurable: true, enumerable: true, get: () => dt.files
        });
      } catch (err) {
        Object.defineProperty(this, 'files', {
          configurable: true, enumerable: true, get: () => constructed
        });
      }
      this.dispatchEvent(new Event('change', {bubbles: true}));
      this.dispatchEvent(new Event('input', {bubbles: true}));
    };
    window.parent.postMessage({
      vmIframeId: iframeId,
      cysoOpenFile: true,
      requestId,
      accept: exts,
      multiple
    }, '*');
    return undefined;
  };
})();

context.isWorker = false;
context.centralDispatchService = {
    postMessage (message, transfer) {
        const data = {
            vmIframeId: id,
            message
        };
        if (transfer) {
            window.parent.postMessage(data, '*', transfer);
        } else {
            window.parent.postMessage(data, '*');
        }
    }
};

require('./extension-worker');

window.parent.postMessage({
    vmIframeId: id,
    ready: true
}, '*');
