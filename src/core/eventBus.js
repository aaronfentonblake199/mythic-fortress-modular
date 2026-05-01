export function createEventBus() {
  const listeners = new Map();

  function on(eventName, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('Event handler must be a function.');
    }
    const eventHandlers = listeners.get(eventName) ?? new Set();
    eventHandlers.add(handler);
    listeners.set(eventName, eventHandlers);
    return () => off(eventName, handler);
  }

  function off(eventName, handler) {
    const eventHandlers = listeners.get(eventName);
    if (!eventHandlers) return;
    eventHandlers.delete(handler);
    if (eventHandlers.size === 0) listeners.delete(eventName);
  }

  function emit(eventName, payload) {
    const eventHandlers = listeners.get(eventName);
    if (!eventHandlers) return;
    for (const handler of eventHandlers) {
      handler(payload);
    }
  }

  return { on, off, emit };
}

const defaultEventBus = createEventBus();
export const on = defaultEventBus.on;
export const off = defaultEventBus.off;
export const emit = defaultEventBus.emit;
