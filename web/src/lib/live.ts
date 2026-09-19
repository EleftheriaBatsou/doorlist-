import { onBeforeUnmount, ref } from 'vue';
import type { LiveMessage } from './types';

/**
 * WebSocket subscription to one event's live channel (server relays cache pub/sub).
 * Reconnects with backoff; `connected` drives the UI's live indicator.
 */
export function useLive(eventId: () => string | undefined, onMessage: (m: LiveMessage) => void, onReconnect?: () => void) {
  const connected = ref(false);
  let ws: WebSocket | null = null;
  let retry = 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let everConnected = false;

  function open() {
    const id = eventId();
    if (!id || closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?event=${id}`);
    ws.onopen = () => {
      connected.value = true;
      retry = 0;
      if (everConnected) onReconnect?.(); // resync anything missed while disconnected
      everConnected = true;
    };
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data));
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      connected.value = false;
      if (closed) return;
      timer = setTimeout(open, Math.min(1000 * 2 ** retry++, 10_000));
    };
  }

  function stop() {
    closed = true;
    clearTimeout(timer);
    ws?.close();
  }

  open();
  onBeforeUnmount(stop);
  return { connected, stop };
}
