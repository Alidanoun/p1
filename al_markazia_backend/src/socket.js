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

    // --- 🛡️ SECURITY: JWT Handshake Middleware ---
    io.use((socket, next) => {
      try {
        const token = socket.handshake.auth?.token || socket.handshake.headers['x-auth-token'];
        if (!token) return next(new Error('Unauthorized'));
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const { ROLES } = require('./shared/socketEvents');
        const role = (decoded.role || ROLES.CUSTOMER).toLowerCase();

        socket.user = { id: decoded.id, phone: decoded.phone, role };
        next();
      } catch (err) {
        next(new Error('Unauthorized'));
      }
    });

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
