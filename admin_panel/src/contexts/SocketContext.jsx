import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import api from '../api/client';

const SocketContext = createContext();

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [liveMetrics, setLiveMetrics] = useState(null);
  const [metricsHistory, setMetricsHistory] = useState([]); // 📈 Weighted window of 10
  const orderLastVersions = useRef({}); // 🛡️ Version Guard (OrderId -> Version)
  const socketRef = useRef(null);

  const fetchNotifications = async () => {
    try {
      const res = await api.get('/notifications');
      setNotifications(res.data);
      setUnreadCount(res.data.filter(n => !n.isRead).length);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  };

  const fetchLiveMetrics = async () => {
    try {
      const res = await api.get('/dashboard/metrics');
      if (res.data.success) {
        setLiveMetrics(res.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
    }
  };

  const _mergeActivityFeeds = (oldFeed, newFeed) => {
    const combined = [...newFeed, ...oldFeed];
    const seen = new Set();
    return combined.filter(item => {
      const duplicate = seen.has(item.id);
      seen.add(item.id);
      return !duplicate;
    }).slice(0, 20); // Keep top 20
  };

  const _playBeep = () => {
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
  };

  // 🔄 Create and connect socket with the current token
  const connectSocket = useCallback((token) => {
    // Close old socket if exists
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    if (!token) return;

    const newSocket = io(SOCKET_URL, {
      reconnection: true,
      reconnectionAttempts: 5,       // Try 5 times before giving up
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      auth: { token }                // 🛡️ Standardized JWT handshake
    });
    
    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      // Room joining is now largely deterministic on server-side based on JWT role,
      // but we still send the join signal for explicit UI transitions if needed.
      newSocket.emit('join:admin'); 
      newSocket.emit('join:dashboard');
      fetchNotifications();
      fetchLiveMetrics();
    });

    // 🛡️ Handle auth errors - try token refresh
    newSocket.on('connect_error', async (err) => {
      console.error('Socket connection error:', err.message);

      if (err.message.includes('Unauthorized') || err.message.includes('token') || err.message.includes('expired')) {
        console.log('🔄 Socket auth failed, attempting token refresh...');
        
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) {
          console.error('No refresh token available, forcing logout');
          localStorage.removeItem('token');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          window.location.href = '/';
          return;
        }

        try {
          const response = await api.post('/auth/refresh', { refreshToken });
          const { accessToken, refreshToken: newRefreshToken } = response.data;

          localStorage.setItem('token', accessToken);
          localStorage.setItem('refreshToken', newRefreshToken);

          console.log('✅ Token refreshed, reconnecting socket...');
          // Reconnect with new token
          newSocket.auth = { token: accessToken };
          newSocket.connect();
        } catch (refreshErr) {
          console.error('Token refresh failed:', refreshErr);
          localStorage.removeItem('token');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          window.location.href = '/';
        }
      }
    });

    // 🧠 LIVE COMMAND CENTER LISTENER (Analytics Hub)
    // Matches: SOCKET_EVENTS.DASHBOARD_METRICS_UPDATE
    newSocket.on('dashboard:metrics:update', (metrics) => {
      console.log('📊 Real-time Metrics Update Received');
      
      setLiveMetrics(prev => {
        // 🛡️ Sequence State Guard (Global Source of Truth)
        if (prev && metrics.sequence < prev.sequence) {
          console.warn('⚠️ Stale analytics packet ignored', { incoming: metrics.sequence, current: prev.sequence });
          return prev; 
        }

        // 📈 Trend Intelligence Calculation (Rolling Windows)
        setMetricsHistory(h => {
          const newHistory = [...h, metrics];
          return newHistory.slice(-10); // Keep last 10
        });

        return metrics;
      });
    });

    newSocket.on('reconnect', (attemptNumber) => {
      console.log('Socket reconnected after', attemptNumber, 'attempts');
      newSocket.emit('join:admin'); 
      newSocket.emit('join:dashboard');
      fetchNotifications();
      fetchLiveMetrics(); 
    });

    // 📡 Standardized System Notifications (Matching Unified Contract)
    newSocket.on('order:created', (data) => {
      const order = data;
      
      toast.success('طلب جديد 🔔', {
        description: `طلب جديد رقم (${order.orderNumber}) بانتظار القبول.`,
        duration: 10000,
        position: 'top-center'
      });
      _playBeep();
      fetchNotifications();
    });

    newSocket.on('order:updated', (data) => {
      const order = data;
      const { fingerprint } = order;
      
      const priority = fingerprint?.priority || 'HIGH';

      if (priority === 'CRITICAL' || priority === 'HIGH') {
        toast.info(`تحديث: ${order.orderNumber}`, {
          description: `الحالة الجديدة: ${order.status}`,
          duration: 4000,
        });
      }
      fetchNotifications();
    });

    // Handle legacy notifications for general alerts
    newSocket.on('new_admin_notification', (notification) => {
      setNotifications(prev => [notification, ...prev]);
      setUnreadCount(prev => prev + 1);
      toast.success(notification.title, {
        description: notification.message,
        duration: 5000,
      });
      _playBeep();
    });

    socketRef.current = newSocket;
    setSocket(newSocket);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    connectSocket(token);

    // 🔄 Listen for token refresh events from API interceptor
    const handleTokenRefresh = (event) => {
      const newToken = event.detail?.token;
      if (newToken) {
        console.log('🔄 Token refreshed via API interceptor, reconnecting socket...');
        connectSocket(newToken);
      }
    };

    window.addEventListener('token:refreshed', handleTokenRefresh);

    return () => {
      window.removeEventListener('token:refreshed', handleTokenRefresh);
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [connectSocket]);

  const markAsRead = async (id) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error(err);
    }
  };

  const markAllAsRead = async () => {
    try {
      await api.put('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  };

  return (
    <SocketContext.Provider value={{ 
      socket, 
      notifications, 
      unreadCount, 
      liveMetrics,
      metricsHistory,
      markAsRead, 
      markAllAsRead, 
      fetchNotifications,
      fetchLiveMetrics
    }}>
      {children}
    </SocketContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSocket = () => useContext(SocketContext);
