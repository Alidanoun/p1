import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import api, { unwrap } from '../api/client';
import { tokenStore } from '../api/tokenStore';
import { useAuth } from './AuthContext';
import { useDebounce } from '../hooks/useDebounce';

const SocketContext = createContext();

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const SocketProvider = ({ children }) => {
  const { user, selectedBranchId } = useAuth();
  const [socket, setSocket] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [liveMetrics, setLiveMetrics] = useState(null);
  const [metricsHistory, setMetricsHistory] = useState([]);
  const socketRef = useRef(null);

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

  const fetchLiveMetrics = useCallback(async () => {
    try {
      const url = selectedBranchId 
        ? `/dashboard/metrics?branchId=${selectedBranchId}` 
        : '/dashboard/metrics';
      const response = await api.get(url);
      const data = unwrap(response);
      
      if (data) {
        setLiveMetrics(data);
      } else if (response.data && response.data.revenue) { 
        // Fallback for legacy format if metrics are top-level and not under 'data'
        setLiveMetrics(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
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
      transports: ['websocket']        // Stability optimization
    });
    
    // 🧪 Debug Exposure: Allow inspection in Console
    window.socket = newSocket;

    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      newSocket.emit('join:admin'); 
      
      // 🏢 Join Dashboard Context using unified branch:switch
      newSocket.emit('branch:switch', { branchId: selectedBranchId }, (response) => {
        if (response?.success) {
          console.log(`[Socket] Branch context established: ${response.branchId}`);
          fetchLiveMetrics();
        } else {
          console.error('[Socket] Branch context switch failed:', response?.error);
        }
      });

      fetchNotifications();
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

    newSocket.on('reconnect', () => {
      newSocket.emit('join:admin'); 
      newSocket.emit('branch:switch', { branchId: selectedBranchId }, (res) => {
        if (res?.success) fetchLiveMetrics();
      });
      fetchNotifications();
    });

    // 📡 Standardized System Notifications
    newSocket.on('order:created', (order) => {
      toast.success('طلب جديد 🔔', {
        description: `طلب جديد رقم (${order.orderNumber}) بانتظار القبول.`,
        duration: 10000,
        position: 'top-center'
      });
      _playBeep();
      fetchNotifications();
    });

    newSocket.on('order:updated', (order) => {
      if (['ready', 'in_route', 'cancelled'].includes(order.status)) {
        toast.info(`تحديث: ${order.orderNumber}`, {
          description: `الحالة الجديدة: ${order.status}`,
          duration: 4000,
        });
      }
      fetchNotifications();
    });

    newSocket.on('new_admin_notification', (notification) => {
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
  }, [selectedBranchId, fetchLiveMetrics, fetchNotifications, cleanupSocket]);

  const debouncedBranchId = useDebounce(selectedBranchId, 300);

  useEffect(() => {
    if (socketRef.current && debouncedBranchId !== undefined) {
      // 🔄 Switch Rooms dynamically using the unified branch:switch event
      setLiveMetrics(null); // Clear while fetching
      
      socketRef.current.emit('branch:switch', { branchId: debouncedBranchId }, (response) => {
        if (response?.success) {
          console.log(`[Socket] Dynamic branch switch successful: ${debouncedBranchId}`);
          fetchLiveMetrics();
        } else {
          console.error('[Socket] Dynamic branch switch failed:', response?.error);
        }
      });
    }
  }, [debouncedBranchId, fetchLiveMetrics]);

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
