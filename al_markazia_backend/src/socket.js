const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./config/secrets');
const logger = require('./utils/logger');

let io;
let isReady = false;
let readyResolvers = [];

module.exports = {
  init: (httpServer) => {
    io = new Server(httpServer, {
      cors: {
        origin: (process.env.CORS_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean),
        methods: ["GET", "POST"],
        credentials: true
      }
    });

    const connections = new Map();

    // --- 🛡️ SECURITY: JWT Handshake Middleware ---
    io.use((socket, next) => {
      try {
        const token = socket.handshake.auth?.token || socket.handshake.headers['x-auth-token'];
        if (!token) {
          logger.warn('🔌 [Socket V5] Connection rejected: No token provided.', { ip: socket.handshake.address });
          return next(new Error('Unauthorized'));
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const { ROLES } = require('./shared/socketEvents');
        const role = (decoded.role || ROLES.CUSTOMER).toLowerCase();
        const userId = decoded.id;

        // 🛡️ [SEC-FIX] Concurrent Connection Limit
        const userConnections = connections.get(userId) || 0;
        if (userConnections >= 5) {
          logger.security('🔌 [Socket] Connection rejected: Too many concurrent sessions', { userId });
          return next(new Error('TOO_MANY_CONNECTIONS'));
        }

        connections.set(userId, userConnections + 1);
        socket.user = { id: userId, phone: decoded.phone, role };

        socket.on('disconnect', () => {
          const current = connections.get(userId) || 1;
          if (current <= 1) connections.delete(userId);
          else connections.set(userId, current - 1);
        });

        next();
      } catch (err) {
        logger.warn('🔌 [Socket V5] Connection rejected: Invalid JWT.', { error: err.message, ip: socket.handshake.address });
        next(new Error('Unauthorized'));
      }
    });

    const trackingService = require('./services/trackingService');
    const { SOCKET_ROOMS } = require('./shared/socketEvents');

    io.on('connection', (socket) => {
      const { id: userId, role } = socket.user;

      if (role === 'admin') {
        socket.join(['admins', 'system-logs']);
        logger.debug('🛡️ Admin joined monitoring channels', { socketId: socket.id });
      }

      // 🛰️ Join Tracking Room
      socket.on('tracking:join', async ({ orderId }) => {
        const canTrack = await trackingService.canTrackOrder(userId, orderId);
        if (canTrack || role === 'admin') {
          const room = SOCKET_ROOMS.ORDER_TRACKING(orderId);
          socket.join(room);
          logger.debug(`🛰️ User ${userId} joined tracking for order ${orderId}`);
        } else {
          socket.emit('error', { message: 'Unauthorized to track this order' });
        }
      });

      // 🚚 Driver Location Update (From Driver App or Simulation)
      socket.on('tracking:update_location', (data) => {
        // Only allow if role is 'driver' or 'admin' (assuming 'admin' for simulation)
        trackingService.updateDriverLocation(io, data);
      });
    });

    // 🕵️ System Audit: Monitor Active Sockets & Rooms every 5 mins
    setInterval(() => {
      const roomCount = io.sockets.adapter.rooms.size;
      const clientCount = io.engine.clientsCount;
      logger.debug('📡 [Socket Audit] Status', { activeClients: clientCount, activeRooms: roomCount });
    }, 5 * 60 * 1000);

    // Mark as ready and notify all waiting promises
    isReady = true;
    logger.info('📡 Socket.IO Server marked as READY');
    readyResolvers.forEach(resolve => resolve(io));
    readyResolvers = [];

    return io;
  },

  /**
   * ⏳ Wait for Socket to be ready (Critical for startup sequence)
   */
  waitReady: () => {
    if (isReady) return Promise.resolve(io);
    return new Promise(resolve => readyResolvers.push(resolve));
  },

  getIO: () => {
    if (!io) {
      logger.error('❌ CRITICAL: Attempted to getIO() before initialization');
      throw new Error('Socket.io not initialized!');
    }
    return io;
  },

  isReady: () => isReady
};
