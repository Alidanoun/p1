import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import { getCookie } from '../lib/utils';
import api, { unwrap } from '../api/client';
import { tokenStore } from '../api/tokenStore';
import { useAuth } from './AuthContext';
import { useDebounce } from '../hooks/useDebounce';

const SocketContext = createContext();

const SOCKET_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000');

export const SocketProvider = ({ children }) => {
  const { user, selectedBranchId } = useAuth();
  const [socket, setSocket] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [liveMetrics, setLiveMetrics] = useState(null);
  const [metricsHistory, setMetricsHistory] = useState([]);
  const socketRef = useRef(null);
  const abortControllerRef = useRef(null);
  const switchTimeoutRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await api.get('/notifications');
      const notificationsList = unwrap(response) || [];
      
      const list = Array.isArray(notificationsList) ? notificationsList : [];
      setNotifications(list);
      setUnreadCount(list.filter(n => !n.isRead).length);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, []);

  const fetchLiveMetrics = useCallback(async (signal = null) => {
    try {
      const branchId = selectedBranchId;
      const url = branchId ? `/dashboard/metrics?branchId=${branchId}` : '/dashboard/metrics';
      const response = await api.get(url, { signal });
      const data = unwrap(response);
      
      if (data && (!signal || !signal.aborted)) {
        setLiveMetrics(data);
      }
    } catch (err) {
      if (err.name !== 'CanceledError' && err.name !== 'AbortError') {
        console.error('Failed to fetch metrics:', err);
      }
    }
  }, [selectedBranchId]);

  const _playBeep = useCallback(() => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.value = 800;
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      oscillator.start();
      setTimeout(() => oscillator.stop(), 300);
    } catch(e) { console.error('Audio beep failed', e); }
  }, []);

  // 🛡️ Deep Cleanup Utility: Ensures no listeners or ghost connections remain
  const cleanupSocket = useCallback(() => {
    if (socketRef.current) {
      console.log('🔌 [Socket] Deep Cleanup: Removing listeners and disconnecting...');
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
      setSocket(null);
    }
  }, []);

  const handleSync = useCallback((socketInstance) => {
    if (!socketInstance) return;
    console.log('📡 [Socket] Syncing state...');
    socketInstance.emit('join:admin'); 
    socketInstance.emit('branch:switch', { branchId: selectedBranchId }, (res) => {
      if (res?.success) {
        fetchLiveMetrics();
        fetchNotifications();
      }
    });
  }, [selectedBranchId, fetchLiveMetrics, fetchNotifications]);

  // 🔄 Create and connect socket with the current token from MEMORY
  const connectSocket = useCallback((token) => {
    // 🛡️ [GUARD] Singleton Check: Don't reconnect if we already have a valid connection with the SAME token
    if (socketRef.current?.connected && socketRef.current.auth?.token === token) {
      return;
    }

    // 🧹 Kill any existing instance before creating a new one
    cleanupSocket();

    if (!token) return;

    const newSocket = io(SOCKET_URL, {
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000,
      auth: { token },                 // 🛡️ From memory store
      withCredentials: true,           // ✅ Important for cookie-based handshake
      extraHeaders: {
        'x-xsrf-token': getCookie('XSRF-TOKEN') || '' // 🛡️ Double Cookie Submit for Socket.io
      },
      transports: ['websocket']        // Stability optimization
    });
    
    // 🧪 Debug Exposure: Allow inspection in Console
    window.socket = newSocket;

    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      handleSync(newSocket);
    });

    newSocket.on('reconnect', () => {
      console.log('Socket reconnected');
      handleSync(newSocket);
    });

    newSocket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
      if (err.message === 'Unauthorized' || err.message === 'UNAUTHORIZED_OR_INACTIVE') {
         toast.error('فشل الاتصال: الجلسة غير صالحة. يرجى إعادة تسجيل الدخول.');
      }
    });

    // 🧠 LIVE COMMAND CENTER LISTENER
    newSocket.on('dashboard:metrics:update', (metrics) => {
      setLiveMetrics(prev => {
        if (prev && metrics.sequence < prev.sequence) return prev; 
        setMetricsHistory(h => [...h, metrics].slice(-10));
        return metrics;
      });
    });

    // 🛡️ [DEDUPLICATION] Event Tracking
    const processedEvents = new Set();
    const isDuplicate = (eventId) => {
      if (!eventId) return false;
      if (processedEvents.has(eventId)) return true;
      processedEvents.add(eventId);
      if (processedEvents.size > 100) {
        const firstValue = processedEvents.values().next().value;
        processedEvents.delete(firstValue);
      }
      return false;
    };

    // 📡 Standardized System Notifications
    newSocket.on('order:created', (payload) => {
      const { eventId, data: order } = payload;
      if (isDuplicate(eventId)) return;

      toast.success('طلب جديد 🔔', {
        description: `طلب جديد رقم (${order.orderNumber}) بانتظار القبول.`,
        duration: 10000,
        position: 'top-center'
      });
      _playBeep();
      fetchNotifications();
    });

    newSocket.on('order:updated', (payload) => {
      const { eventId, data: order } = payload;
      if (isDuplicate(eventId)) return;

      if (['ready', 'in_route', 'cancelled'].includes(order.status)) {
        toast.info(`تحديث: ${order.orderNumber}`, {
          description: `الحالة الجديدة: ${order.status}`,
          duration: 4000,
        });
      }
      fetchNotifications();
    });

    newSocket.on('new_admin_notification', (payload) => {
      const { eventId, data: notification } = payload;
      if (isDuplicate(eventId)) return;

      setNotifications(prev => [notification, ...prev]);
      setUnreadCount(prev => prev + 1);
      toast.success(notification.title, {
        description: notification.message,
        duration: 5000,
      });
      _playBeep();
    });

    // 🛡️ Real-Time Authorization Sync (Force Refresh)
    newSocket.on('permissions:updated', () => {
      console.warn('[Socket] Permissions updated on server. Syncing...');
      newSocket.emit('permissions:refresh', (res) => {
        if (res?.success) console.log('[Socket] Permissions synced successfully.');
      });
    });

    // 🚫 Access Revoked Handler
    newSocket.on('force:branch:reset', ({ reason }) => {
      console.error('[Socket] ACCESS REVOKED:', reason);
      toast.error('تم سحب صلاحية الوصول لهذا الفرع', {
        description: 'سيتم تحويلك الآن إلى الواجهة الرئيسية.',
        duration: 8000
      });
      setLiveMetrics(null);
      // Logic to redirect or reset branch state in UI could go here
      window.location.reload(); // Hard reset for safety
    });

    socketRef.current = newSocket;
    setSocket(newSocket);
  }, [fetchLiveMetrics, fetchNotifications, cleanupSocket, selectedBranchId]);

  const debouncedBranchId = useDebounce(selectedBranchId, 300);

  useEffect(() => {
    // 🛡️ Only trigger if we have a valid debounced ID (null is valid for 'All Branches')
    const performSwitch = async () => {
      // 🛑 1. Cancel any ongoing switch/fetch
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (switchTimeoutRef.current) clearTimeout(switchTimeoutRef.current);

      // ✨ 2. Initialize new Controller
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const { signal } = controller;

      console.log(`[SocketContext] Branch switch sequence started: ${debouncedBranchId}`);
      
      // 🧹 3. Reset state to avoid stale data flicker
      setLiveMetrics(null);
      setMetricsHistory([]);

      try {
        // 📡 4. Socket Switch with Timeout Guard
        if (socketRef.current?.connected) {
          await new Promise((resolve, reject) => {
            switchTimeoutRef.current = setTimeout(() => {
              controller.abort();
              reject(new Error('Socket switch timeout'));
            }, 8000);

            socketRef.current.emit('branch:switch', { branchId: debouncedBranchId }, (res) => {
              clearTimeout(switchTimeoutRef.current);
              if (signal.aborted) return reject(new Error('Aborted'));
              if (res?.success) resolve(res);
              else reject(new Error(res?.error || 'Branch switch rejected by server'));
            });
          });
        }

        // 📊 5. Fetch fresh metrics via HTTP (Using the LATEST debounced ID)
        if (!signal.aborted) {
          // 🚀 [FIX] Use debouncedBranchId directly to avoid stale selectedBranchId from closures
          const url = debouncedBranchId ? `/dashboard/metrics?branchId=${debouncedBranchId}` : '/dashboard/metrics';
          const response = await api.get(url, { signal });
          const data = unwrap(response);
          
          if (data && !signal.aborted) {
            setLiveMetrics(data);
          }
          
          await fetchNotifications();
        }

      } catch (err) {
        if (err.name !== 'CanceledError' && err.name !== 'AbortError') {
          console.error('[SocketContext] Switch Sequence Failed:', err.message);
          toast.error('حدث خطأ أثناء مزامنة بيانات الفرع الجديد');
        }
      }
    };

    performSwitch();

    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (switchTimeoutRef.current) clearTimeout(switchTimeoutRef.current);
    };
  }, [debouncedBranchId]); // 🎯 [FIX] Only depend on debounced ID to prevent redundant/stale triggers

  useEffect(() => {
    // 🛡️ Initialization: Try to connect with whatever is in store
    const initialToken = tokenStore.get();
    if (initialToken) {
      connectSocket(initialToken);
      fetchLiveMetrics(); // 🚀 [UI-FIX] Boot metrics via HTTP immediately to avoid stuck UI
    }
    
    // 🔄 Reactive Synchronization: Reconnect whenever the token rotates in memory
    const unsubscribe = tokenStore.subscribe((newToken) => {
      if (newToken) {
        console.log('🔄 Socket Context: Token rotated, reconnecting...');
        connectSocket(newToken);
        // 🚀 [FIX] fetchLiveMetrics() removed here to prevent infinite refresh loops
      } else {
        cleanupSocket();
      }
    });

    return () => {
      unsubscribe();
      cleanupSocket();
    };
  }, [connectSocket, cleanupSocket]);

  // 🏥 Socket Health Check: Passive monitoring (Let engine handle reconnection)
  useEffect(() => {
    const healthCheck = setInterval(() => {
      if (socketRef.current && !socketRef.current.connected) {
        console.warn('[Socket] Connection lost. Built-in engine is handling retry...');
      }
    }, 30000); // Check every 30s
    
    return () => clearInterval(healthCheck);
  }, []);

  const markAsRead = async (id) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) { console.error(err); }
  };

  const markAllAsRead = async () => {
    try {
      await api.put('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) { console.error(err); }
  };

  return (
    <SocketContext.Provider value={{ 
      socket, notifications, unreadCount, liveMetrics, metricsHistory,
      markAsRead, markAllAsRead, fetchNotifications, fetchLiveMetrics
    }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
