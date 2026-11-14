import { useState, useEffect, useRef, useCallback } from "react";
import { WhatsAppStatus, ActivePicker, ToastMessage } from "../types";

export function useWebSocket() {
  const [status, setStatus] = useState<WhatsAppStatus>("disconnected");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [activePicker, setActivePicker] = useState<ActivePicker | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let unmounted = false;
    let reconnectTimeout: any;

    function connect() {
      if (unmounted) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.hostname;
      const wsUrl = `${protocol}//${host}:3001`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "WA_STATUS") {
            setStatus(data.status);
            setQrDataUrl(data.qrDataUrl);
          } else if (data.type === "PICKER_OPEN") {
            setActivePicker({
              triggerId: data.triggerId,
              query: data.query,
              candidates: data.candidates || [],
            });
          } else if (data.type === "PICKER_CLOSE") {
            setActivePicker((prev) => (prev?.triggerId === data.triggerId ? null : prev));
          } else if (data.type === "TOAST_NOTIFY") {
            const newToast: ToastMessage = {
              id: `${Date.now()}-${Math.random()}`,
              status: data.status,
              message: data.message,
              tag: data.tag,
            };
            setToasts((prev) => [...prev, newToast]);
            setTimeout(() => {
              setToasts((prev) => prev.filter((t) => t.id !== newToast.id));
            }, 4000);
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!unmounted) {
          reconnectTimeout = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      unmounted = true;
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const selectSticker = useCallback((triggerId: string, stickerId: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "PICKER_SELECT",
          triggerId,
          stickerId,
        })
      );
    }
    setActivePicker(null);
  }, []);

  const cancelPicker = useCallback((triggerId: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "PICKER_CANCEL",
          triggerId,
        })
      );
    }
    setActivePicker(null);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return {
    status,
    qrDataUrl,
    activePicker,
    toasts,
    selectSticker,
    cancelPicker,
    dismissToast,
  };
}
