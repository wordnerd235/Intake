// bus.js - tiny pub/sub. Events: 'change:<collection>', 'sync:status', 'date:change', 'store:erased'.
// A handler registered for 'change:*' receives every 'change:<collection>' event.

/**
 * Create an isolated bus (tests create one per simulated device).
 * @returns {{on:(evt:string, fn:Function)=>()=>void, off:(evt:string, fn:Function)=>void, emit:(evt:string, payload?:*)=>void}}
 */
export function createBus() {
  /** @type {Map<string, Set<Function>>} */
  const map = new Map();
  const call = (set, evt, payload) => {
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload, evt);
      } catch (e) {
        console.error(`bus handler for ${evt} failed`, e);
      }
    }
  };
  return {
    on(evt, fn) {
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(fn);
      return () => this.off(evt, fn);
    },
    off(evt, fn) {
      const s = map.get(evt);
      if (s) s.delete(fn);
    },
    emit(evt, payload) {
      call(map.get(evt), evt, payload);
      const i = evt.indexOf(':');
      if (i > 0) call(map.get(`${evt.slice(0, i)}:*`), evt, payload);
    },
  };
}

/** App-wide bus. */
export const bus = createBus();
