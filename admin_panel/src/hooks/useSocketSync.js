import { useEffect, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext';

/**
 * 🔄 useSocketSync Hook
 * Automatically triggers a refresh function when the socket reconnects.
 * Ensures the UI state remains in sync with the server after network interruptions.
 */
export const useSocketSync = (refreshFn, dependencies = []) => {
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
  }, [socket, ...dependencies]);

  // Return the refresh function for manual triggering if needed
  return refreshRef.current;
};
