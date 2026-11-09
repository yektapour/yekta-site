/* Yekta Light — host adapters. Same UI runs in: Photoshop (UXP), desktop app (Electron, for Clip Studio Paint), browser.
   Performance rules: no polling, no timers while idle; colour writes are coalesced (only the latest is sent). */
(function (L) {
  'use strict';
  const C = L.color;

  // coalescing queue: while one write is in flight, newer requests replace the pending one
  function queue(apply) {
    let busy = false, pending = null;
    return function (v) {
      pending = v;
      if (busy) return;
      busy = true;
      (async () => {
        while (pending) {
          const c = pending; pending = null;
          try { await apply(c); } catch (e) { console.warn('[Yekta Light]', e); }
        }
        busy = false;
      })();
    };
  }

  function photoshop(ps) {
    const { app, core, action } = ps;
    const rgbDesc = (c) => { const v = C.to255(c); return { _obj: 'RGBColor', red: v[0], grain: v[1], blue: v[2] }; };
    const setProp = (prop) => async (c) => {
      await core.executeAsModal(async () => {
        await action.batchPlay([{ _obj: 'set', _target: [{ _ref: 'color', _property: prop }], to: rgbDesc(c), source: 'photoshopPicker', _options: { dialogOptions: 'dontDisplay' } }], {});
      }, { commandName: 'Yekta Light color' });
    };
    const readFG = () => { try { const c = app.foregroundColor.rgb; return [c.red / 255, c.green / 255, c.blue / 255]; } catch (e) { return null; } };
    const listeners = [];
    let installed = false;
    function install() {
      if (installed) return;
      installed = true;
      // event-driven: Photoshop tells us when FG changes (eyedropper, picker, X swap, D reset) — zero cost while idle
      try {
        action.addNotificationListener(['set', 'exchange', 'reset'], (ev, desc) => {
          if (ev === 'set') { const t = desc && desc._target && desc._target[0]; if (!t || t._property !== 'foregroundColor') return; }
          const c = readFG();
          listeners.forEach((f) => f(c));
        });
      } catch (e) { console.warn('[Yekta Light] notifications unavailable', e); }
    }
    return {
      kind: 'photoshop', name: 'Photoshop', canPin: false, sendLabel: 'Set FG',
      setColor: queue(setProp('foregroundColor')),
      setBG: queue(setProp('backgroundColor')),
      async getColor() { return readFG(); },
      onColorChange(f) { listeners.push(f); install(); },
      async addSwatches(list) {
        await core.executeAsModal(async () => {
          await action.batchPlay(list.map((s) => ({ _obj: 'make', _target: [{ _ref: 'colors' }], using: { _obj: 'colors', name: s.name, color: rgbDesc(s.color) }, _options: { dialogOptions: 'dontDisplay' } })), {});
        }, { commandName: 'Yekta Light swatches' });
      },
    };
  }

  function electron(n) {
    return {
      kind: 'desktop', name: 'Desktop', canPin: true, sendLabel: 'Copy',
      setColor: queue(async (c) => n.copy(C.toHex(c).toUpperCase())),
      async getColor() { try { return C.fromHex(await n.read()); } catch (e) { return null; } },
      copyText: (t) => n.copy(t),
      setPin: (b) => n.setPin(b),
      getPin: () => n.getPin(),
    };
  }

  function web() {
    const copy = async (t) => { try { if (navigator.clipboard) await navigator.clipboard.writeText(t); } catch (e) { /* ignore */ } };
    return {
      kind: 'web', name: 'Browser', canPin: false, sendLabel: 'Copy',
      setColor: queue(async (c) => copy(C.toHex(c).toUpperCase())),
      async getColor() { try { return C.fromHex(await navigator.clipboard.readText()); } catch (e) { return null; } },
      copyText: copy,
    };
  }

  let host = null;
  try {
    if (typeof require === 'function') {
      const ps = require('photoshop');
      if (ps && ps.app && ps.core) host = photoshop(ps);
    }
  } catch (e) { /* not in Photoshop */ }
  if (!host && window.yektaNative) host = electron(window.yektaNative);
  if (!host) host = web();
  L.host = host;
})((window.Yekta = window.Yekta || {}));
