const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('./utils/logger');
const TokenService = require('./services/tokenService');
const { SOCKET_ROOMS } = require('./shared/socketEvents');
const { getRequestId, getCorrelationId } = require('./utils/context');
const { trace } = require('@opentelemetry/api');

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

    const { createAdapter } = require('@socket.io/redis-adapter');
    const { publisher, socketSubscriber } = require('./lib/redis');

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

    // 📡 [CLUSTER-SYNC] Initialize Redis Adapter BEFORE any connections
    // 📡 [CLUSTER-SYNC] Initialize Redis Adapter BEFORE any connections
    io.adapter(createAdapter(publisher, socketSubscriber));
    logger.info('📡 Socket.io Redis Adapter enabled (Distributed Sockets Active)');
    
    // --- 🛡️ SDS 3.0: Global Smart Broadcast Helper ---
    io.broadcastSmart = async (room, type, payload) => {
      const sockets = await io.in(room).fetchSockets();
      for (const socket of sockets) {
        if (socket.smartEmit) {
          await socket.smartEmit(type, payload);
        } else {
          socket.emit(type, payload);
        }
      }
    };

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
        // 🛡️ [SEC-FIX] Read from headers OR handshake.auth/query (browsers don't support custom headers in WebSocket transport)
        const csrfTokenFromHeader = socket.handshake.headers['x-xsrf-token'] || 
                                    socket.handshake.auth?.xsrfToken || 
                                    socket.handshake.query?.xsrfToken;

        // 🔒 [SEC-FIX] Double Cookie Submit Validation
        const userAgent = socket.handshake.headers['user-agent'] || '';
        const isBrowserClient = userAgent.includes('Mozilla') || userAgent.includes('Chrome') || userAgent.includes('Safari');
        
        // 📱 تطبيقات الموبايل (Flutter/Dart) لا ترسل cookies ولا تحتاج CSRF
        // 🌐 المتصفحات يجب أن ترسل cookie + header معاً (يمكن تخطي الفحص للتطوير المحلي عبر مفتاح DISABLE_SOCKET_CSRF)
        if (isBrowserClient && process.env.DISABLE_SOCKET_CSRF !== 'true') {
          if (!csrfTokenFromCookie || !csrfTokenFromHeader) {
            logger.security('🔌 [SocketCSRF] Browser connection rejected: missing CSRF cookie or header', {
              ip: socket.handshake.address,
              userAgent
            });
            return next(new Error('CSRF_VALIDATION_FAILED'));
          }
          if (csrfTokenFromCookie !== csrfTokenFromHeader) {
            logger.security('🔌 [SocketCSRF] Browser connection rejected: CSRF token mismatch', {
              ip: socket.handshake.address,
              userAgent
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
        
        const SecurityPolicyService = require('./services/securityPolicyService');
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
          branchId: dbIdentity?.branchId || null,
          jti: decoded.sid || decoded.jti,
          av: decoded.av || 1,
          pv: decoded.pv || 1
        };

        // 🛡️ [SDS 2.0] Security Metadata Initialization
        socket.data = {
          authRooms: new Set(), // 🏛️ Managed Security Rooms (Zombie Room Killer)
          leaseExpiresAt: Date.now() + (60 * 1000), // ⏱️ 60s Authorization Lease
          lastSyncSequence: 0,
          consecutiveFailures: 0
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

    io.on('connection', async (socket) => {
      // 📊 [METRICS] Initialize Metadata
      socketMetadata.set(socket.id, {
        connectedAt: new Date(),
        messageCount: 0,
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'] || 'Unknown'
      });

      const { id: userId, role, branchId } = socket.user;
      
      // 🛡️ [SDS 2.0] Authorization Lease Middleware (Efficient Continuous Validation)
      socket.use(async ([event, ...args], next) => {
        try {
          if (Date.now() > socket.data.leaseExpiresAt) {
            // Lease expired, re-validate against Central Registry
            await socket.recalculateRooms();
            socket.data.consecutiveFailures = 0; // Reset on success
          }
          next();
        } catch (err) {
          socket.data.consecutiveFailures = (socket.data.consecutiveFailures || 0) + 1;
          logger.warn(`[SDS 2.0] Lease validation failed (${socket.data.consecutiveFailures}/3)`, { error: err.message });
          
          // 🔴 STRICT BOUNDED STALE LEASE: Do not permit infinite stale access
          if (socket.data.consecutiveFailures >= 3) {
            logger.security('[SDS 2.0] Maximum stale tolerance exceeded. Evicting socket from managed rooms forcefully.');
            for (const room of socket.data.authRooms) {
              socket.leave(room);
            }
            socket.data.authRooms.clear();
            return next(new Error('SECURITY_LEASE_EXPIRED'));
          }
          
          next(); // Allow in Degraded Mode safely within bounds
        }
      });

      const { SOCKET_ROOMS, ROLES } = require('./shared/socketEvents');

      // 🛡️ [SDS 3.0] Smart Emitter with Backpressure Governance
      socket.smartEmit = async (type, payload) => {
        const { getGovernance, INTENTS } = require('./shared/eventGovernance');
        const cPath = './lib/container';
        const container = require(cPath);
        const pressureService = container.pressureService;
        const gov = getGovernance(type);

        // 1. 🩸 Check if event should be dropped (Adaptive Degradation)
        if (pressureService.shouldDrop(gov.intent)) {
          return; // Dropped silently for performance, tracked in pressureService metrics
        }

        // 2. 🐌 Slow Consumer Guard (Backpressure)
        // If the socket output buffer is too full, we downgrade to Invalidation-only
        if (socket.conn.transport.writable && socket.bufferedAmount > 512 * 1024) { // 512KB buffer limit
          logger.warn(`🐌 [SlowConsumer] User ${userId} buffer full. Throttling...`);
          if (gov.intent === INTENTS.BEST_EFFORT) return; // Drop non-essential
          // Force Invalidation only (Strip full data from payload if present)
          if (payload.order) payload = { action: 'INVALIDATE', aggregateId: payload.aggregateId };
        }

        // 3. 🛰️ Invalidation Coalescing (The Debouncer)
        // Only debounce if we are under high load to keep normal latency zero.
        if (gov.intent === INTENTS.INVALIDATION && pressureService.isCoalescingRequired()) {
          const debounceKey = `debounce:${userId}:${type}:${payload.aggregateId}`;
          if (socket.data[debounceKey]) {
            clearTimeout(socket.data[debounceKey]);
          }
          
          const SecurityPolicyService = require('./services/securityPolicyService');
          socket.data[debounceKey] = setTimeout(() => {
            socket.emit(type, SecurityPolicyService.wrapPayload(payload));
            delete socket.data[debounceKey];
          }, 300); // 300ms Coalescing Window
          return;
        }

      // 🚀 Normal Dispatch
      const requestId = getRequestId();
      const correlationId = getCorrelationId();
      const activeSpan = trace.getActiveSpan();
      const traceId = activeSpan?.spanContext()?.traceId;

      const enrichedPayload = {
        ...payload,
        _tracing: {
          requestId,
          correlationId,
          traceId,
          emittedAt: new Date().toISOString()
        }
      };

      const SecurityPolicyService = require('./services/securityPolicyService');
      socket.emit(type, SecurityPolicyService.wrapPayload(enrichedPayload));
    };

      socket.joinManaged = async (room) => {
        if (!room) return;
        await socket.join(room);
        socket.data.authRooms.add(room);
      };

      socket.recalculateRooms = async () => {
        const transitionId = (socket.data.transitionId || 0) + 1;
        socket.data.transitionId = transitionId;
        socket.data.recalcInProgress = true;

        try {
          // 🛡️ Authoritative Ground Truth Security Check: Evict instantly if blocked/deleted
          const SecurityPolicyService = require('./services/securityPolicyService');
          const status = await SecurityPolicyService.checkUserStatus(socket.user.id);
          
          if (socket.data.transitionId !== transitionId) return;

          if (!status || !status.isActive || status.isBlacklisted) {
            for (const room of socket.data.authRooms) {
              socket.leave(room);
            }
            socket.data.authRooms.clear();
            socket.disconnect(true);
            throw new Error('USER_REVOKED');
          }

          // 1. Fetch LIVE snapshot safely FIRST before leaving current healthy state
          const liveContext = await SecurityPolicyService.getTargetRooms(socket.user);
          
          // ✅ Verify that this call is still the latest transition
          if (socket.data.transitionId !== transitionId) {
            return; // Stale execution, discard safely
          }

          // 2. Leave old rooms safely only after fetching successful updates
          const targetSet = new Set(liveContext);
          for (const room of socket.data.authRooms) {
            if (!targetSet.has(room)) {
              socket.leave(room);
              socket.data.authRooms.delete(room);
            }
          }

          // 3. Re-join valid rooms
          for (const room of liveContext) {
            await socket.joinManaged(room);
          }

          socket.data.leaseExpiresAt = Date.now() + (60 * 1000); // Reset lease
          logger.debug(`[SDS 2.0] Rooms recalculated for user ${socket.user.id}`);
        } catch (err) {
          logger.error('[SDS 2.0] Room recalculation failed, retaining existing valid room layouts safely', { error: err.message });
          // Propagate error so lease consecutive failure counter intercepts it
          throw err;
        } finally {
          if (socket.data.transitionId === transitionId) {
            socket.data.recalcInProgress = false;
          }
        }
      };

      const SecurityPolicyService = require('./services/securityPolicyService');
      const rooms = await SecurityPolicyService.getTargetRooms(socket.user);
      for (const room of rooms) {
        await socket.joinManaged(room);
      }
      
      logger.debug(`🛡️ v2 Boundary Sync Complete for user ${userId} [${role}]`);

      // 👤 Private User Room (The ultimate boundary)
      socket.join(SOCKET_ROOMS.CUSTOMER(userId));

      // 🏢 Support Global Admin Room explicitly for monitoring webboards
      socket.on('join:admin', async () => {
        if (['admin', 'branch_manager', 'manager'].includes(role)) {
          await socket.join('admin');
          logger.debug(`[Socket] User ${userId} successfully joined admin broadcast room`);
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
            const auditService = require('./services/auditService');
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
          if (branchId) await socket.join(SOCKET_ROOMS.EXEC_BRANCH(branchId));
          socket.data.activeBranchId = branchId || 'GLOBAL';
          logger.info(`[Socket] User ${userId} switched context to branch ${branchId}`);

          // 📝 6. Audit Log (Success)
          const auditService = require('./services/auditService');
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

          // ✅ Debounce/throttle duplicate sync calls during quick connection cycles
          if (socket.data.recalcInProgress) {
            await new Promise(resolve => setTimeout(resolve, 150));
            if (socket.data.recalcInProgress) {
              if (ack) ack({ success: true, timestamp: Date.now() });
              return;
            }
          }

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

          const auditService = require('./services/auditService');
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
    if (process.env.NODE_ENV !== 'test') {
      setInterval(() => {
        const roomCount = io.sockets.adapter.rooms.size;
        const clientCount = io.engine.clientsCount;
        logger.debug('📡 [Socket Audit] Status', { activeClients: clientCount, activeRooms: roomCount });
      }, 5 * 60 * 1000);

      // 🛡️ [SEC-FIX] Periodic Security Revalidation (Every 60s)
      // Ensures long-lived sockets don't drift from DB security state.
      setInterval(async () => {
        const sockets = await io.fetchSockets();
        for (const s of sockets) {
          if (s.user) {
            const validation = await TokenService.validateSessionState({
              id: s.user.id,
              sid: s.user.jti,
              av: s.user.av,
              pv: s.user.pv
            });

            if (!validation.valid) {
              logger.security('📡 [Socket] Periodic validation failed. Notifying client.', { userId: s.user.id, reason: validation.reason });
              s.emit('AUTH_REVALIDATE_REQUIRED', { reason: validation.reason });
              
              // Give client 5s to refresh/reconnect, then force disconnect
              setTimeout(() => s.disconnect(true), 5000);
            }
          }
        }
      }, 60 * 1000);
    }

    // Mark as ready and notify all waiting promises
    isReady = true;
    logger.info('📡 Socket.IO Server marked as READY');
    readyResolvers.forEach(resolve => resolve(io));
    readyResolvers = [];

    return io;
  },

  /**
   * 🚨 Remote Revalidation Trigger
   * Called by Event Handlers when global permissions change.
   */
  revalidateUser: async (userId) => {
    if (!io) return;
    const sockets = await io.fetchSockets();
    const userSockets = sockets.filter(s => s.user?.id === userId);
    
    for (const s of userSockets) {
      logger.info(`📡 [Socket] Remote revalidation triggered for user ${userId}`);
      s.emit('AUTH_REVALIDATE_REQUIRED', { reason: 'PERMISSIONS_CHANGED' });
      // Short grace period before enforcement
      setTimeout(() => s.disconnect(true), 15000);
    }
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
