const express = require('express'); // Heartbeat: 2026-05-02 01:57
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const csrf = require('csurf');
const timeout = require('connect-timeout');
const morgan = require('morgan');
require('dotenv').config();
require('./config/secrets');

// 🌐 Centralized API Router (Versioned)
const apiV1Router = require('./routes/index');

const http = require('http');
const net = require('net');
const os = require('os');
const { initCronJobs } = require('./jobs/cronJobs');
const { initOrderWorker, setupQueueDashboard } = require('./queues/orderQueue');
const { initHealthWorker } = require('./queues/healthWorker');
const { requestTracing } = require('./middleware/requestTracing');
const { shadowMirrorMiddleware } = require('./middleware/shadowMirrorMiddleware');
const externalProbeController = require('./controllers/externalProbeController');
const warmupService = require('./services/warmupService');
const prisma = require('./lib/prisma');
const logger = require('./utils/logger');
const socketModule = require('./socket');

const app = express();
const server = http.createServer(app);

// 🛡️ [SEC-FIX] Trust Proxy Configuration
// Enable trusting the immediate proxy (like Nginx/loopback) to get the real client IP
app.set('trust proxy', 'loopback');

async function startServer() {
  try {
    // 3. Initialize Distributed Services
    const cacheService = require('./services/cacheService');
    const happyHourService = require('./services/happyHourService');
    
    const io = socketModule.init(server);
    happyHourService.setIO(io);

    await Promise.all([
      happyHourService.initialize()
    ]);
    
    logger.info('🚀 Systems Initialized: Cache, Socket, HappyHour');

    // 2. 🚀 Initialize Event-Driven Architecture (AWAITED)
    const eventSystem = require('./events/init');
    await eventSystem.init();

    // 3. Start Background Workers
    initCronJobs(io);
    initOrderWorker(io);
    initHealthWorker().catch(err => logger.error('[Startup] Health Worker failed', { error: err.message }));

    // 4. Register Middleware
    const performanceMonitor = require('./middleware/performanceMonitor');
    app.use(requestTracing);
    app.use(performanceMonitor);
    app.use(shadowMirrorMiddleware);
    
    // 🛡️ [SEC-FIX] Robust CSP & Security Headers
    app.use(helmet({ 
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"], 
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "blob:", "https://*.cloudinary.com", "https://*.googleusercontent.com"], 
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
          baseUri: ["'self'"],
          formAction: ["'self'"]
        }
      }
    }));
    
    // ⏱️ [SEC-FIX] Robust Request Timeout
    app.use(timeout('5s'));
    app.use((req, res, next) => {
      if (!req.timedout) next();
    });
    
    app.use(cookieParser());
    
    // 🛡️ CSRF Protection (Double Cookie Method - Strict Mode)
    const csrfProtection = csrf({ 
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict' // 🔒 Level 5 Security: Block cross-site session leaking
      }
    });
    
    // Apply CSRF protection selectively
    app.use((req, res, next) => {
      const isAuthRoute = req.path.startsWith('/auth') || req.path.startsWith('/api/auth') || req.path.startsWith('/api/v1/auth');
      const hasAuthHeader = req.headers.authorization;
      
      if (isAuthRoute || hasAuthHeader) {
        return next(); 
      }
      
      csrfProtection(req, res, (err) => {
        if (err) return next(err);
        res.cookie('XSRF-TOKEN', req.csrfToken(), {
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict'
        });
        next();
      });
    });

    const { apiLimiter } = require('./middleware/advancedRateLimiter');
    app.use(apiLimiter);
    
    // CORS Setup
    const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean);
    
    // 🛡️ SEC-FIX: Use Regex for strict origin matching to prevent CORS bypass
    // Convert allowedOrigins array to an array of RegExp objects for exact matching
    const allowedOriginRegexes = allowedOrigins.map(origin => {
      // Escape dots and create a strict boundary regex
      const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`^${escaped}$`);
    });

    app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g., same-origin requests, file://, Postman)
        if (!origin) return callback(null, true);
        
        // Auto-allow Localhost/127.0.0.1/192.168.x.x for development comfort
        // Pattern: Matches http/https with localhost, 127.0.0.1, or 192.168.x.x (with optional port)
        const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin);

        // Check if the origin exactly matches any of the allowed origins using regex
        const isAllowed = allowedOriginRegexes.some(regex => regex.test(origin));

        if (isLocal || isAllowed) {
          callback(null, true);
        } else {
          // Log rejected origin for debugging and security monitoring
          logger.warn(`🛡️ [CORS] Rejected unauthorized origin: ${origin}`);
          callback(new Error('Not allowed by CORS'), false);
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));

    app.use(express.json({ limit: '100kb', strict: true }));
    app.use(express.urlencoded({ extended: true, limit: '100kb' }));

    const sanitizeBranchId = require('./middleware/sanitizeBranchId');
    app.use(sanitizeBranchId);

    // ⏱️ Request Timeout Hardening
    app.use((req, res, next) => {
      req.setTimeout(5000); // 5 seconds max
      next();
    });

    // HTTP Logging
    morgan.token('client-ip', (req) => req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress);
    
    app.use(morgan(':client-ip - :method :url :status - :response-time ms', {
      stream: { write: (message) => logger.http(message.trim()) },
      skip: (req, res) => req.originalUrl === '/health' || (process.env.NODE_ENV === 'production' && res.statusCode < 400)
    }));

    // 🖼️ Serve Static Files (Uploaded Images)
    const path = require('path');
    app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

    // 🕵️ System Audit (Sensitive Routes)
    const auditMiddleware = require('./middleware/auditMiddleware');
    app.use(auditMiddleware);

    // ─── API Deprecation Policy (Lifecycle Management) ───────
    const deprecation = require('./middleware/deprecation');
    app.use((req, res, next) => {
      const isVersioned = req.path.startsWith('/api/v1');
      const isInternal = req.path.startsWith('/uploads') || 
                        req.path.startsWith('/socket.io') || 
                        req.path === '/health/external';

      if (!isVersioned && !isInternal) {
        return deprecation({
          alternative: `/api/v1${req.path}`,
          date: '2026-12-31' // End of support for legacy endpoints
        })(req, res, next);
      }
      next();
    });

    // ─── API Routes (Versioned) ──────────────────────────────
    // Primary: All new clients should use /api/v1/
    app.use('/api/v1', apiV1Router);

    // Legacy: Backward compatibility for existing Flutter app & admin panels
    // TODO: Remove after all clients migrate to /api/v1/
    app.use('/', apiV1Router);

    // Health Checks (external probes — always at root)
    app.get('/health/external', externalProbeController.pings);


    // 🚨 Global Error Handler (Centralized Survival Layer)
    const { handleError } = require('./utils/errorHandler');
    app.use((err, req, res, next) => {
      handleError(err, req, res, next);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', { promise, reason });
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception thrown:', { error: err.message, stack: err.stack });
      console.error('Uncaught Exception thrown:', err);
      process.exit(1);
    });

    // --- 🔍 PORT RESOLUTION LOGIC ---
    function checkPortAvailable(port) {
      return new Promise((resolve) => {
        const serverCheck = net.createServer();
        serverCheck.once('error', (err) => {
          if (err.code === 'EADDRINUSE') resolve(false);
          else resolve(false);
        });
        serverCheck.once('listening', () => {
          serverCheck.close();
          resolve(true);
        });
        serverCheck.listen(port, '0.0.0.0');
      });
    }

    async function findAvailablePort(startPort) {
      const MAX_ATTEMPTS = 5;
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const port = startPort + i;
        if (await checkPortAvailable(port)) return port;
        logger.warn(`⚠️  Port ${port} is occupied, trying next...`);
      }
      throw new Error(`Failed to find an available port after ${MAX_ATTEMPTS} attempts`);
    }

    const INITIAL_PORT = parseInt(process.env.PORT || 5000, 10);
    const PORT = await findAvailablePort(INITIAL_PORT);
    server.listen(PORT, '0.0.0.0', async () => {
      logger.info(`🚀 Backend Server is running on port ${PORT}`);
      
      // Post-startup Warmup
      // 🛡️ [SAFETY-LAYER] Financial Integrity Handshake
      const { runIntegrityTests } = require('./tests/financialIntegrity');
      const integrityPassed = runIntegrityTests();
      if (!integrityPassed) {
        logger.warn('🧪 Safety Alert: System started with financial integrity warnings.');
      }

      warmupService.run().catch(e => logger.error('Warmup Error', { error: e.message }));
      
      const analyticsProjection = require('./projections/analyticsProjection');
      const orderProjection = require('./projections/orderProjection');
      const SecurityPolicyService = require('./services/securityPolicyService');
      
      await Promise.all([
        analyticsProjection.replay(), 
        orderProjection.replay(),
        SecurityPolicyService.warmupSecurityCache()
      ]).catch(e => logger.error('Rehydration Failed', { error: e.message }));

      // 📊 Periodic Health Status reporting
      setInterval(() => {
        const mem = process.memoryUsage();
        logger.debug(`📊 [HealthReport] Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB | Uptime: ${Math.floor(process.uptime())}s`);
      }, 60000);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`❌ CRITICAL: Port ${PORT} was snatched just before binding!`);
      } else {
        logger.error('❌ Server Error:', err);
      }
      process.exit(1);
    });

  } catch (err) {
    logger.error('❌ CRITICAL STARTUP FAILURE', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info(`[${signal}] Received. Starting graceful shutdown...`);
  
  const timeoutGuard = setTimeout(() => {
    logger.error('❌ Shutdown forced after timeout.');
    process.exit(1);
  }, 15000);

  try {
    // 1. Stop accepting new requests
    server.close(() => {
      logger.info('HTTP server closed.');
    });

    // 2. Close all active connections (Node 18+)
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }

    // 3. Close Socket.IO
    try {
      const socketModule = require('./socket');
      if (socketModule.isReady()) {
        const io = socketModule.getIO();
        io.close();
        logger.info('Socket.IO server closed.');
      }
    } catch (sErr) {
      logger.error('Error closing Socket.IO', { error: sErr.message });
    }

    // 4. Disconnect from DB & Cache & Services
    const cacheService = require('./services/cacheService');
    const happyHourService = require('./services/happyHourService');
    const auditService = require('./services/auditService');

    await Promise.all([
      prisma.$disconnect(),
      cacheService.destroy(),
      happyHourService.destroy(),
      auditService.destroy(),
      new Promise(resolve => setTimeout(resolve, 1500)) // Final grace period
    ]);
    
    logger.info('All services (DB, Cache, HappyHour, Audit) disconnected safely.');

    clearTimeout(timeoutGuard);
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer().catch(err => {
  console.error('❌ FATAL STARTUP ERROR:', err);
  logger.error('FATAL STARTUP ERROR', { error: err.message, stack: err.stack });
  process.exit(1);
});
