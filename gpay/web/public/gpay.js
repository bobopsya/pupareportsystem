/*! GPAY Checkout widget v1. Usage: GPAY.checkout({ paymentId, onSuccess, onFail, onClose }) */
(function () {
  'use strict';
  if (window.GPAY) return;

  var script = document.currentScript;
  var ORIGIN = script ? new URL(script.src).origin : location.origin;
  var current = null;

  function css(el, styles) {
    for (var k in styles) el.style[k] = styles[k];
    return el;
  }

  function close(reason) {
    if (!current) return;
    var c = current;
    current = null;
    window.removeEventListener('message', c.onMessage);
    document.removeEventListener('keydown', c.onKey);
    document.documentElement.style.overflow = c.prevOverflow;
    c.overlay.style.opacity = '0';
    c.frame.style.transform = 'translateY(16px) scale(0.98)';
    setTimeout(function () { c.overlay.remove(); }, 200);
    if (reason === 'close' && typeof c.opts.onClose === 'function') c.opts.onClose({ paymentId: c.paymentId });
  }

  function checkout(opts) {
    opts = opts || {};
    var src;
    if (opts.paymentId) src = ORIGIN + '/pay/' + encodeURIComponent(opts.paymentId);
    else if (opts.url) src = opts.url;
    else throw new Error('GPAY.checkout: передайте paymentId или url');
    if (new URL(src, ORIGIN).origin !== ORIGIN) throw new Error('GPAY.checkout: url должен вести на ' + ORIGIN);
    src += (src.indexOf('?') >= 0 ? '&' : '?') + 'embed=1';
    close();

    var mobile = window.matchMedia('(max-width: 640px)').matches;
    var overlay = css(document.createElement('div'), {
      position: 'fixed', inset: '0', zIndex: '2147483646', background: 'rgba(10,10,25,0.55)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: mobile ? 'flex-end' : 'center', justifyContent: 'center', opacity: '0', transition: 'opacity .2s',
    });
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Оплата GPAY');
    var frame = css(document.createElement('iframe'), {
      width: mobile ? '100%' : 'min(960px, 94vw)', height: mobile ? '94vh' : 'min(720px, 92vh)', border: '0',
      borderRadius: mobile ? '18px 18px 0 0' : '20px', background: '#fff', boxShadow: '0 24px 80px -12px rgba(10,10,40,.45)',
      transform: 'translateY(16px) scale(0.98)', transition: 'transform .25s cubic-bezier(.2,.9,.3,1)',
    });
    frame.src = src;
    frame.allow = 'payment; clipboard-write';
    frame.title = 'Оплата GPAY';
    overlay.appendChild(frame);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close('close'); });
    document.body.appendChild(overlay);

    var c = {
      opts: opts, overlay: overlay, frame: frame, paymentId: opts.paymentId || null, prevOverflow: document.documentElement.style.overflow,
      onMessage: function (e) {
        if (e.origin !== ORIGIN || !e.data || e.data.source !== 'gpay') return;
        c.paymentId = e.data.paymentId || c.paymentId;
        if (e.data.type === 'success' && !c.done) {
          c.done = true;
          if (typeof opts.onSuccess === 'function') opts.onSuccess(e.data);
        } else if (e.data.type === 'fail' && typeof opts.onFail === 'function') opts.onFail(e.data);
        else if (e.data.type === 'close') close('close');
      },
      onKey: function (e) { if (e.key === 'Escape') close('close'); },
    };
    current = c;
    window.addEventListener('message', c.onMessage);
    document.addEventListener('keydown', c.onKey);
    document.documentElement.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      overlay.style.opacity = '1';
      frame.style.transform = 'none';
    });
    return { close: function () { close('close'); } };
  }

  window.GPAY = { checkout: checkout, close: function () { close('close'); }, version: '1.0.0' };

  // <gpay-button payment-id="pay_…">Оплатить</gpay-button>
  if (window.customElements && !customElements.get('gpay-button')) {
    customElements.define('gpay-button', class extends HTMLElement {
      connectedCallback() {
        if (this.shadowRoot) return;
        var root = this.attachShadow({ mode: 'open' });
        var label = this.textContent.trim() || 'Оплатить через GPAY';
        root.innerHTML =
          '<style>button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:10px;height:46px;padding:0 20px;border-radius:12px;' +
          'background:#111;color:#fff;font:600 15px/1 system-ui,sans-serif;transition:background .15s}' +
          'button:hover{background:#2c2c2e}button:focus-visible{outline:2px solid #111;outline-offset:2px}img{width:22px;height:22px;background:#fff;border-radius:6px;padding:1px}</style>' +
          '<button part="button" type="button"><img src="' + ORIGIN + '/gpay-mark.png" alt="" width="22" height="22"><span></span></button>';
        root.querySelector('span').textContent = label;
        var self = this;
        root.querySelector('button').addEventListener('click', function () {
          checkout({
            paymentId: self.getAttribute('payment-id') || undefined,
            url: self.getAttribute('url') || undefined,
            onSuccess: function (d) { self.dispatchEvent(new CustomEvent('gpay:success', { detail: d, bubbles: true })); },
            onFail: function (d) { self.dispatchEvent(new CustomEvent('gpay:fail', { detail: d, bubbles: true })); },
            onClose: function (d) { self.dispatchEvent(new CustomEvent('gpay:close', { detail: d, bubbles: true })); },
          });
        });
      }
    });
  }
})();
