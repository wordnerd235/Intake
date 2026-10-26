// tabsync.js - keep several open tabs of the app in step. Each tab has its own copy of the screen, so a change made in
// one tab is announced on a BroadcastChannel and the others redraw from the shared IndexedDB.
// The announcement is re-emitted with source 'tab', which the cloud sync ignores (the tab that made the change pushes it).

/**
 * Start announcing local changes to other tabs and re-emitting theirs.
 * @param {{on:Function, emit:Function}} bus
 * @param {string} [name] channel name
 * @returns {()=>void} stop function
 */
export function startTabSync(bus, name = 'intake') {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(name);
  const me = Math.random().toString(36).slice(2);
  const off = bus.on('change:*', (p) => {
    if (p && p.source === 'local' && p.collection) channel.postMessage({ from: me, collection: p.collection });
  });
  channel.onmessage = (e) => {
    const m = e && e.data;
    if (!m || m.from === me || typeof m.collection !== 'string') return;
    bus.emit(`change:${m.collection}`, { collection: m.collection, id: null, source: 'tab' });
  };
  return () => {
    off();
    channel.close();
  };
}
