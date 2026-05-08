const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('./utils/logger');
const TokenService = require('./services/tokenService');
const SecurityPolicyService = require('./services/securityPolicyService');
const auditService = require('./services/auditService');
const { SOCKET_ROOMS } = require('./shared/socketEvents');

let io;
let isReady = false;
let readyResolvers = [];

const connections = new Map();
const socketMetadata = new Map();
const recentDisconnects = []; // Rolling buffer for diagnostics

module.exports = {
  init: (httpServer) => {
    const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean);
    const allowedOriginRegexes = allowedOrigins.map(origin => {
      const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`^${escaped}$`);
    });

    io = new Server(httpServer, {
      cors: {
        origin: (origin, callback) => {
          if (!origin) return callback(null, true);
          const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin);
          const isAllowed = allowedOriginRegexes.some(regex => regex.test(origin));
          
          if (isLocal || isAllowed) {
            callback(null, true);
          } else {
            logger.warn(`🛡️ [SocketCORS] Rejected unauthorized origin: ${origin}`);
            callback(new Error('Not allowed by CORS'), false);
          }
        },
        methods: ["GET", "POST"],
        credentials: true
      }
    });
    
    // --- 🛡️ SECURITY: CSRF Protection Middleware (Double Cookie Pattern) ---
    io.use(async (socket, next) => {
      try {
        const { cookie: cookieHeader } = socket.handshake.headers;
        
        // 🛠️ Simple Cookie Parser
        const parseCookies = (str) => {
          if (!str) return {};
          return str.split(';').reduce((acc, c) => {
            const [key, ...v] = c.trim().split('=');
            acc[key] = v.join('=');
            return acc;
          }, {});
        };

        const cookies = parseCookies(cookieHeader);
        const csrfTokenFromCookie = cookies['XSRF-TOKEN'];
        const csrfTokenFromHeader = socket.handshake.headers['x-xsrf-token'];

        // 🛡️ [SEC-FIX] Double Cookie Submit Validation
        // Note: Only enforce if cookies are present (Browser context). 
        // Mobile apps don't use cookies and aren't vulnerable to browser CSRF.
        if (cookieHeader && csrfTokenFromCookie) {
          if (csrfTokenFromCookie !== csrfTokenFromHeader) {
            logger.security('🔌 [SocketCSRF] Connection rejected: CSRF token mismatch or missing header', {
              ip: socket.handshake.address,
              userAgent: socket.handshake.headers['user-agent']
            });
            return next(new Error('CSRF_VALIDATION_FAILED'));
          }
        }

        next();
      } catch (err) {
        logger.error('🔌 [SocketCSRF] Unexpected error during validation', { error: err.message });
        next(new Error('INTERNAL_SECURITY_ERROR'));
      }
    });

    // --- 🛡️ SECURITY: JWT Handshake Middleware (Hardened v2) ---
    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth?.token || socket.handshake.headers['x-auth-token'];
        if (!token) {
          logger.warn('🔌 [Socket V5] Connection rejected: No token provided.', { ip: socket.handshake.address });
          return next(new Error('Unauthorized'));
        }
        
        // 🛡️ Token verification (includes expiry check — verifyAccessToken throws on expired tokens)
        let decoded;
        try {
          decoded = TokenService.verifyAccessToken(token);
        } catch (tokenErr) {
          // Explicit handling for expired or tampered tokens
          logger.security('🔌 [Socket] Connection rejected: Token invalid or expired', { 
            error: tokenErr.message, 
            ip: socket.handshake.address 
          });
          return next(new Error('TOKEN_EXPIRED'));
        }

        const userId = decoded.id;
        const tokenRole = (decoded.role || 'customer').toLowerCase();
        
        // 🛡️ [SEC-FIX] DB is the Truth: Validate user existence and status (supports both Admin/Customer)
        const status = await SecurityPolicyService.checkUserStatus(userId);

        if (!status || !status.isActive || status.isBlacklisted) {
          logger.security('🔌 [Socket] Connection rejected: Identity inactive or blocked', { userId });
          return next(new Error('UNAUTHORIZED_OR_INACTIVE'));
        }

        // 🛡️ [SEC-FIX] Concurrent Connection Limit
        const userConnections = connections.get(userId) || 0;
        if (userConnections >= 5) {
          logger.security('🔌 [Socket] Connection rejected: Too many concurrent sessions', { userId });
          return next(new Error('TOO_MANY_CONNECTIONS'));
        }

        connections.set(userId, userConnections + 1);
        // 🛡️ Re-fetch full context for the socket instance
        const prisma = require('./lib/prisma');
        let dbIdentity = await prisma.user.findUnique({ where: { uuid: userId }, select: { id: true, branchId: true, role: true } });
        if (!dbIdentity) {
          dbIdentity = await prisma.customer.findUnique({ where: { uuid: userId }, select: { id: true } });
        }

        // 🛡️ [PERMISSION-DRIFT-GUARD] Detect role changes since token was issued
        // Prevents Socket Hijacking: user demoted but still holds old elevated token
        let dbRole = dbIdentity?.role?.toLowerCase() || 'customer';
        
        // 🛡️ [GRACEFUL TRANSITION] Allow super_admin and admin to be interchangeable
        const isUnifiedAdmin = (r) => r === 'admin';
        const effectiveTokenRole = isUnifiedAdmin(tokenRole) ? 'admin' : tokenRole;
        
        if (dbIdentity?.role && !isUnifiedAdmin(dbRole) && dbRole !== effectiveTokenRole) {
          logger.security('🔌 [Socket] PERMISSION_DRIFT detected — token role does not match DB role', {
            userId,
            tokenRole,
            dbRole,
            ip: socket.handshake.address
          });
          connections.set(userId, (connections.get(userId) || 1) - 1);
          return next(new Error('PERMISSIONS_CHANGED'));
        }

        socket.user = { 
          id: userId, 
          dbId: dbIdentity?.id,
          role: dbRole, 
          branchId: dbIdentity?.branchId || null 
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
      // 📊 [METRICS] Initialize Metadata
      socketMetadata.set(socket.id, {
        connectedAt: new Date(),
        messageCount: 0,
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'] || 'Unknown'
      });

      const { id: userId, role, branchId } = socket.user;
      
      // 📊 [METRICS] Track activity
      socket.use(([event, ...args], next) => {
        const metadata = socketMetadata.get(socket.id);
        if (metadata) metadata.messageCount++;
        next();
      });

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
          if (canTrack || role === 'admin') {
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
        if (['driver', 'admin'].includes(role)) {
          trackingService.updateDriverLocation(io, data);
        }
      });

      // 🏢 Dynamic Branch Context Switching (Monitoring/Execution)
      socket.on('branch:switch', async ({ branchId }, ack) => {
        try {
          const { role, id: userId } = socket.user;

          // 🔐 1. Strict Role Gate
          const isAllowed = ['admin', 'branch_manager', 'manager'].includes(role);
          if (!isAllowed) {
            logger.security('UNAUTHORIZED_BRANCH_SWITCH_ATTEMPT', { userId, role, requestedBranch: branchId });
            if (ack) ack({ success: false, error: 'Unauthorized' });
            return;
          }

          // 🛡️ [SEC-FIX] Validate branchId (Allow null for admins for 'All Branches' view)
          const isAdmin = ['admin'].includes(role);
          if (!branchId && !isAdmin) {
            logger.warn(`[Socket] Branch switch rejected: Missing branchId for user ${userId}`);
            if (ack) ack({ success: false, error: 'Branch ID is required' });
            return;
          }

          // 🛡️ 2. Validate Target Branch Existence & Status (If specific branch requested)
          if (branchId) {
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
          }

          // 🔐 3. SecurityPolicy Authorization Check
          const SecurityPolicyService = require('./services/securityPolicyService');
          const canAccess = await SecurityPolicyService.canAccessBranch(socket.user, branchId, 'read');
          
          if (!canAccess) {
            await auditService.log({
              userId,
              userRole: role,
              action: 'BRANCH_SWITCH_FORBIDDEN',
              severity: 'HIGH',
              status: 'FAIL',
              metadata: { requestedBranch: branchId }
            });
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

          // 👁️ 5. Join New Branch Context (Global or Specific)
          const targetRoom = branchId ? SOCKET_ROOMS.MONITOR_BRANCH(branchId) : SOCKET_ROOMS.MONITOR_GLOBAL;
          await socket.join(targetRoom);
          socket.data.activeBranchId = branchId || 'GLOBAL';
          logger.info(`[Socket] User ${userId} switched context to branch ${branchId}`);

          // 📝 6. Audit Log (Success)
          await auditService.logBranchSwitch(
            userId,
            role,
            socket.data.activeBranchId, // Previous
            branchId // New
          );

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
                const { mapOrderResponse } = require('./mappers/order.mapper');
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

      // 📊 [MONITORING] Disconnect Audit
      socket.on('disconnect', async (reason) => {
        const metadata = socketMetadata.get(socket.id);
        if (metadata) {
          const duration = Math.floor((Date.now() - metadata.connectedAt) / 1000);
          
          // 🔍 Reason Analysis (Arabic mapping)
          const reasonAr = {
            'transport close': 'إغلاق قناة النقل (Transport Close)',
            'client namespace disconnect': 'إغلاق من العميل (Client Disconnect)',
            'server namespace disconnect': 'إغلاق من السيرفر (Server Disconnect)',
            'ping timeout': 'انتهاء مهلة الاتصال (Ping Timeout)',
            'transport error': 'خطأ في النقل (Transport Error)'
          }[reason] || reason;

          const severity = (reason === 'ping timeout' || reason === 'transport error') ? 'WARNING' : 'INFO';

          await auditService.log({
            userId,
            userRole: role,
            action: 'SOCKET_DISCONNECT',
            status: 'SUCCESS',
            severity,
            metadata: {
              reason,
              reasonAr,
              durationSeconds: duration,
              messageCount: metadata.messageCount,
              ip: metadata.ip,
              userAgent: metadata.userAgent,
              socketId: socket.id
            }
          });

          // 📊 [DIAGNOSTICS] Push to rolling buffer
          recentDisconnects.unshift({
            userId,
            socketId: socket.id,
            reason,
            reasonAr,
            duration,
            timestamp: new Date().toISOString()
          });
          if (recentDisconnects.length > 50) recentDisconnects.pop();

          logger.info(`🔌 [Socket] Disconnected: ${userId} (${reason}) - Duration: ${duration}s`);
          socketMetadata.delete(socket.id);
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

  // 📊 [DIAGNOSTICS] Expose Stats
  getStats: () => {
    if (!io) return null;
    return {
      totalConnections: io.engine.clientsCount,
      totalRooms: io.sockets.adapter.rooms.size,
      activeIdentities: connections.size,
      recentDisconnects: [...recentDisconnects],
      timestamp: new Date().toISOString()
    };
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
