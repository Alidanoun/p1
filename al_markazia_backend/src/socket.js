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

      // 👤 Private User Room (The ultimate boundary)
      socket.join(SOCKET_ROOMS.CUSTOMER(userId));
      
      logger.debug(`🛡️ v2 Boundary Sync Complete for user ${userId} [${role}]`);

      // 🛰️ Join Tracking Room
      socket.on('tracking:join', async ({ orderId }) => {
        try {
          const canTrack = await trackingService.canTrackOrder(userId, orderId);
          if (canTrack || role === 'super_admin' || role === 'admin') {
            const room = SOCKET_ROOMS.ORDER_TRACKING(orderId);
            await socket.join(room);
            logger.info(`🛰️ User ${userId} joined tracking for order ${orderId}`);
          } else {
            logger.security('UNAUTHORIZED_TRACKING_JOIN', { userId, orderId, ip: socket.handshake.address });
            socket.emit('error', { message: 'غير مصرح لك بتتبع هذا الطلب' });
          }
        } catch (err) {
          logger.error('[Socket] Tracking join failed', { userId, orderId, error: err.message });
        }
      });

      // 🚚 Driver Location Update (From Driver App or Simulation)
      socket.on('tracking:update_location', (data) => {
        // Only allow if role is 'driver' or 'admin'
        if (['driver', 'admin', 'super_admin'].includes(role)) {
          trackingService.updateDriverLocation(io, data);
        }
      });

      // 🏢 Dynamic Branch Context Switching (Monitoring/Execution)
      socket.on('branch:switch', async ({ branchId }, ack) => {
        try {
          const { role, id: userId } = socket.user;

          // 🔐 1. Strict Role Gate
          if (!['super_admin', 'admin', 'branch_manager', 'manager'].includes(role)) {
            logger.security('UNAUTHORIZED_BRANCH_SWITCH_ATTEMPT', { userId, role, requestedBranch: branchId });
            if (ack) ack({ success: false, error: 'Unauthorized' });
            return;
          }

          // 🛡️ 2. Validate Target Branch Existence & Status
          const prisma = require('./lib/prisma');
          const branch = await prisma.branch.findUnique({
            where: { id: branchId },
            select: { id: true, isActive: true }
          });

          if (!branch || !branch.isActive) {
            logger.warn(`[Socket] Branch switch rejected: Invalid or inactive branch ${branchId}`);
            if (ack) ack({ success: false, error: 'الفرع المحدد غير موجود أو غير نشط' });
            return;
          }

          // 🔐 3. SecurityPolicy Authorization Check
          const SecurityPolicyService = require('./services/securityPolicyService');
          const canAccess = await SecurityPolicyService.canAccessBranch(socket.user, branchId, 'read');
          
          if (!canAccess) {
            logger.security('FORBIDDEN_BRANCH_SWITCH_ATTEMPT', { userId, role, requestedBranch: branchId });
            if (ack) ack({ success: false, error: 'غير مصرح لك بالوصول لبيانات هذا الفرع' });
            return;
          }

          // 🧹 4. Complete Context Cleanup (Remove from all previous branch rooms)
          const currentRooms = Array.from(socket.rooms);
          for (const room of currentRooms) {
            if (room.startsWith('room:exec:') || room.startsWith('room:monitor:')) {
              await socket.leave(room);
            }
          }

          // 👁️ 5. Join New Branch Context
          const targetRoom = SOCKET_ROOMS.MONITOR_BRANCH(branchId);
          await socket.join(targetRoom);
          socket.data.activeBranchId = branchId; 

          logger.info(`[Socket] User ${userId} switched context to branch ${branchId}`);
          if (ack) ack({ success: true, branchId });
        } catch (err) {
          logger.error(`[Socket] Branch switch failed for user ${userId}`, err);
          if (ack) ack({ success: false, error: 'Internal Server Error' });
        }
      });

      // 🛡️ Real-Time Authorization Sync (Client Triggered)
      socket.on('permissions:refresh', async (ack) => {
        try {
          const SecurityPolicyService = require('./services/securityPolicyService');
          await SecurityPolicyService.invalidateUserPermissions(userId);
          if (ack) ack({ success: true, timestamp: Date.now() });
        } catch (err) {
          logger.error(`[Socket] Permission refresh failed for ${userId}`, err);
          if (ack) ack({ success: false });
        }
      });

      // 🔄 [SYNC-PROTOCOL] Handle Full State Synchronization (Post-Reconnection)
      socket.on('sync:full', async (ack) => {
        try {
          logger.info(`[Socket] 🔄 Sync requested by user ${userId} [${role}]`);

          // 1. Refresh User State
          const prisma = require('./lib/prisma');
          const freshUser = await prisma.user.findUnique({
            where: { uuid: userId },
            select: { id: true, role: true, branchId: true, isActive: true }
          });

          if (!freshUser || !freshUser.isActive) {
            socket.emit('error', { message: 'Account inactive, disconnecting...' });
            socket.disconnect(true);
            return;
          }

          // 2. Refresh Context
          socket.user = {
            id: userId,
            role: freshUser.role.toLowerCase(),
            branchId: freshUser.branchId,
            dbId: freshUser.id
          };

          // 3. Re-Sync Rooms
          const SecurityPolicyService = require('./services/securityPolicyService');
          const targetRooms = await SecurityPolicyService.getTargetRooms(socket.user);
          
          // Clear current rooms (except private room)
          const currentRooms = Array.from(socket.rooms);
          for (const room of currentRooms) {
            if (room.startsWith('room:')) await socket.leave(room);
          }

          // Join fresh rooms
          targetRooms.forEach(room => socket.join(room));

          // 4. Push Latest Orders (For Managers)
          if (['branch_manager', 'manager'].includes(socket.user.role)) {
            const activeOrders = await prisma.order.findMany({
              where: { 
                branchId: socket.user.branchId,
                status: { notIn: ['delivered', 'cancelled'] },
                isDeleted: false
              },
              orderBy: { updatedAt: 'desc' },
              take: 50,
              include: { 
                orderItems: { include: { product: true } }
              }
            });

            socket.emit('orders:sync', {
              orders: activeOrders.map(o => {
                const { mapOrderResponse } = require('./services/orderService');
                return mapOrderResponse(o);
              }),
              timestamp: Date.now()
            });
          }

          if (ack) ack({ success: true, timestamp: Date.now() });
          logger.info(`[Socket] ✅ Sync complete for user ${userId}`);
        } catch (err) {
          logger.error(`[Socket] Sync failed for user ${userId}`, err);
          if (ack) ack({ success: false, error: 'Sync failed' });
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
