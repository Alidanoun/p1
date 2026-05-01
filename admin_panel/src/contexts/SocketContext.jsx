import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import api, { unwrap } from '../api/client';
import { tokenStore } from '../api/tokenStore';
import { useAuth } from './AuthContext';

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

  const fetchNotifications = async () => {
    try {
      const response = await api.get('/notifications');
      const notificationsList = unwrap(response) || [];
      
      const list = Array.isArray(notificationsList) ? notificationsList : [];
      setNotifications(list);
      setUnreadCount(list.filter(n => !n.isRead).length);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  };

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

  // 🔄 Create and connect socket with the current token from MEMORY
  const connectSocket = useCallback((token) => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

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
    
    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      newSocket.emit('join:admin'); 
      
      // 🏢 Join Dashboard Context
      if (selectedBranchId) {
        newSocket.emit('join:branch:dashboard', { branchId: selectedBranchId });
      } else {
        newSocket.emit('join:dashboard');
      }

      fetchNotifications();
      fetchLiveMetrics();
    });

    newSocket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
      // We don't manually refresh here anymore. 
      // The tokenStore listener or next API call will trigger rotation if needed.
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
      newSocket.emit('join:dashboard');
      fetchNotifications();
      fetchLiveMetrics(); 
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

    socketRef.current = newSocket;
    setSocket(newSocket);
  }, []);

  useEffect(() => {
    if (socketRef.current) {
      // 🔄 Switch Rooms without full reconnect if possible, 
      // but for simplicity, we'll just re-fetch and re-emit join
      if (selectedBranchId) {
        socketRef.current.emit('leave:dashboard');
        socketRef.current.emit('join:branch:dashboard', { branchId: selectedBranchId });
      } else {
        socketRef.current.emit('leave:branch:dashboard');
        socketRef.current.emit('join:dashboard');
      }
      setLiveMetrics(null); // Clear while fetching
      fetchLiveMetrics();
    }
  }, [selectedBranchId, fetchLiveMetrics]);

  useEffect(() => {
    // 🛡️ Initialization: Try to connect with whatever is in store
    const initialToken = tokenStore.get();
    if (initialToken) connectSocket(initialToken);

    // 🔄 Reactive Synchronization: Reconnect whenever the token rotates in memory
    const unsubscribe = tokenStore.subscribe((newToken) => {
      if (newToken) {
        console.log('🔄 Socket Context: Token rotated, reconnecting...');
        connectSocket(newToken);
      } else {
        if (socketRef.current) {
          socketRef.current.close();
          socketRef.current = null;
          setSocket(null);
        }
      }
    });

    return () => {
      unsubscribe();
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
