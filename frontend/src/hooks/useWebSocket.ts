'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export type SignalMessage = {
  type: string;
  room_id: string;
  [key: string]: any;
};

export default function useWebSocket(
  roomId: string | null,
  onMessage: (msg: SignalMessage) => void
) {
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  const pendingMessagesRef = useRef<SignalMessage[]>([]); // 🧠 Buffer unsent messages

  // Update handler without reconnecting
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!roomId) {
      // Cleanup when no room
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      setConnected(false);
      pendingMessagesRef.current = [];
      return;
    }

    // Close existing connection if it exists
    if (socketRef.current && socketRef.current.readyState !== WebSocket.CLOSED) {
      socketRef.current.close();
      socketRef.current = null;
    }

    const ws = new WebSocket('ws://localhost:8000/ws');
    socketRef.current = ws;
    setConnected(false);

    console.log('[WebSocket] Connecting to room:', roomId);

    ws.onopen = () => {
      console.log('[WebSocket] Connected and joined room:', roomId);
      setConnected(true);

      const joinPayload: SignalMessage = { type: 'join_room', room_id: roomId };
      ws.send(JSON.stringify(joinPayload));

      // Flush buffered messages
      if (pendingMessagesRef.current.length > 0) {
        console.log(`[WebSocket] Sending ${pendingMessagesRef.current.length} buffered messages`);
        pendingMessagesRef.current.forEach((msg) => {
          ws.send(JSON.stringify(msg));
        });
        pendingMessagesRef.current = [];
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[WebSocket] Received:', data);
        onMessageRef.current(data);
      } catch (err) {
        console.error('[WebSocket] Invalid message format:', event.data);
      }
    };

    ws.onerror = (err) => {
      console.error('[WebSocket] Error:', err);
    };

    ws.onclose = () => {
      console.log('[WebSocket] Disconnected');
      setConnected(false);
      socketRef.current = null;
    };

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      setConnected(false);
    };
  }, [roomId]);

  const sendMessage = useCallback((message: SignalMessage) => {
    const socket = socketRef.current;

    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        console.log('[WebSocket] Sending:', message);
        socket.send(JSON.stringify(message));
      } catch (err) {
        console.error('[WebSocket] Failed to send:', err);
      }
    } else {
      console.warn('[WebSocket] Buffering message until connected:', message);
      pendingMessagesRef.current.push(message);
    }
  }, []);

  return { sendMessage, connected };
}
