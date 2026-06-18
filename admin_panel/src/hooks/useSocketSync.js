import { useEffect, useRef, useCallback } from 'react';
import { useSocket } from './useSocket';

/**
 * 🔄 useSocketSync Hook
 * Automatically triggers a refresh function when the socket reconnects.
 * Ensures the UI state remains in sync with the server after network interruptions.
 */
export const useSocketSync = (refreshFn) => {
  const { socket } = useSocket();
  const refreshRef = useRef(refreshFn);

  // Keep the latest refresh function without triggering re-effects
  useEffect(() => {
    refreshRef.current = refreshFn;
  }, [refreshFn]);

  useEffect(() => {
    if (!socket) return;

    const handleReconnect = () => {
      console.log('📡 [SocketSync] Reconnection detected. Triggering data refresh...');
      if (refreshRef.current) {
        refreshRef.current();
      }
    };

    // 1. Listen for reconnection
    socket.on('connect', handleReconnect);
    
    // 2. Also trigger on 'reconnect' (specific to socket.io-client)
    socket.on('reconnect', handleReconnect);

    return () => {
      socket.off('connect', handleReconnect);
      socket.off('reconnect', handleReconnect);
    };
  }, [socket]);

  // ✅ Return a stable wrapper function that reads the ref when called (not during render)
  const stableRefresh = useCallback(() => {
    if (refreshRef.current) {
      refreshRef.current();
    }
  }, []);

  return stableRefresh;
};
