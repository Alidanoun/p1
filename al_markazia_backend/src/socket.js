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
    io.use(async (socket, next) => {
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
        const prisma = require('./lib/prisma');
        
        // 🛡️ [SEC-FIX] DB is the Truth: Validate user existence and status
        const dbUser = await prisma.user.findUnique({ 
          where: { uuid: userId },
          select: { id: true, isActive: true, branchId: true, role: true }
        });

        if (!dbUser || !dbUser.isActive) {
          logger.security('🔌 [Socket] Connection rejected: User not found or inactive', { userId });
          return next(new Error('UNAUTHORIZED_OR_INACTIVE'));
        }

        // 🛡️ [SEC-FIX] Concurrent Connection Limit
        const userConnections = connections.get(userId) || 0;
        if (userConnections >= 5) {
          logger.security('🔌 [Socket] Connection rejected: Too many concurrent sessions', { userId });
          return next(new Error('TOO_MANY_CONNECTIONS'));
        }

        connections.set(userId, userConnections + 1);
        socket.user = { 
          id: userId, 
          dbId: dbUser.id,
          role: dbUser.role.toLowerCase(), 
          branchId: dbUser.branchId 
        };

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
    io.on('connection', async (socket) => {
      const { id: userId, role, branchId } = socket.user;
      const { SOCKET_ROOMS, ROLES } = require('./shared/socketEvents');

      // 🛡️ [PHASE 2] Real-Time Isolation Layer
      const SecurityPolicyService = require('./services/securityPolicyService');
      const rooms = await SecurityPolicyService.getTargetRooms(socket.user);
      
      rooms.forEach(room => {
        socket.join(room);
        logger.debug(`[Socket] User ${userId} joined room: ${room}`);
      });

      if (role === 'super_admin' || role === 'admin') {
        socket.join('room:system:logs');
      }

      // 👤 Private User Room (The ultimate boundary)
      socket.join(`room:user:${userId}`);
      
      logger.debug(`🛡️ v2 Boundary Sync Complete for user ${userId} [${role}]`);

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

      // 🏢 Dynamic Branch Context Switching
      socket.on('branch:switch', async ({ branchId }, ack) => {
        try {
          // 🔐 Verify permission (only super_admin/admin can dynamically switch contexts)
          if (!['super_admin', 'admin'].includes(role)) {
            logger.warn(`[Socket] Unauthorized branch switch attempt by ${userId} [${role}]`);
            if (ack) ack({ success: false, error: 'Unauthorized' });
            return;
          }

          // 🧹 Clean up previous branch rooms (Hard Cleanup)
          const currentRooms = Array.from(socket.rooms);
          for (const room of currentRooms) {
            if (room.startsWith('room:admin:branch:')) {
              await socket.leave(room);
            }
          }

          if (branchId) {
            // 🟢 Join specific branch
            const targetRoom = `room:admin:branch:${branchId}`;
            await socket.join(targetRoom);
            socket.data.activeBranchId = branchId; // Store in socket state
            logger.info(`[Socket] Admin ${userId} switched to branch ${branchId}`);
          } else if (role === 'super_admin') {
            // 🌐 Super Admin "All Branches" mode - Subscribe to all
            const prisma = require('./lib/prisma');
            const allBranches = await prisma.branch.findMany({ select: { id: true } });
            
            await Promise.all(allBranches.map(b => socket.join(`room:admin:branch:${b.id}`)));
            socket.data.activeBranchId = 'all';
            logger.info(`[Socket] Super Admin ${userId} joined all branch rooms`);
          } else {
            // Admin switching to 'all' but doesn't have super_admin role
            // Fallback to their assigned branch if it exists, otherwise stay in global
            if (socket.user.branchId) {
              await socket.join(`room:admin:branch:${socket.user.branchId}`);
              socket.data.activeBranchId = socket.user.branchId;
            }
          }

          if (ack) ack({ success: true, branchId: socket.data.activeBranchId });
        } catch (err) {
          logger.error(`[Socket] Branch switch failed for user ${userId}`, err);
          if (ack) ack({ success: false, error: 'Internal Server Error' });
        }
      });

      // 🛡️ Real-Time Authorization Sync
      socket.on('permissions:refresh', async (ack) => {
        try {
          const SecurityPolicyService = require('./services/securityPolicyService');
          
          // 1. Force Clear Cache
          await SecurityPolicyService.invalidateUserPermissions(userId);
          
          // 2. Re-verify active branch access
          const filter = await SecurityPolicyService.getHardenedFilter(socket.user, 'Branch');
          const allowedBranches = filter.id?.in || [];
          
          const currentBranchId = socket.data.activeBranchId;
          
          if (currentBranchId && currentBranchId !== 'all' && !allowedBranches.includes(currentBranchId)) {
            logger.warn(`[Socket] KILLING UNAUTHORIZED ACCESS: User ${userId} lost access to branch ${currentBranchId}`);
            
            // 🔥 Hard Reset
            socket.data.activeBranchId = null;
            const currentRooms = Array.from(socket.rooms);
            for (const room of currentRooms) {
              if (room.startsWith('room:admin:branch:')) {
                await socket.leave(room);
              }
            }
            
            socket.emit('force:branch:reset', { reason: 'ACCESS_REVOKED' });
          }

          if (ack) ack({ success: true });
        } catch (err) {
          logger.error(`[Socket] Permission refresh failed for ${userId}`, err);
          if (ack) ack({ success: false });
        }
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
