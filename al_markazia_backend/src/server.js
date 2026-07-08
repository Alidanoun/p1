require('./lib/otel');
const express = require('express'); // Heartbeat: 2026-05-02 01:57
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const timeout = require('connect-timeout');
const morgan = require('morgan');
require('dotenv').config();
require('./config/secrets');
const EnvValidator = require('./config/envValidator');

// 🛡️ Validate Environment before anything else
EnvValidator.validate();

const { initSentry, Sentry } = require('./config/sentry');

// 🛡️ Initialize Security Shield (Sentry) before any other logic
initSentry();

// 🌐 Centralized API Router (Versioned)
const apiV1Router = require('./routes/index');

const http = require('http');
const net = require('net');
const os = require('os');
const { initCronJobs } = require('./jobs/cronJobs');
const { initOrderWorker, setupQueueDashboard } = require('./queues/orderQueue');
const { initHealthWorker } = require('./queues/healthWorker');
const { requestTracing } = require('./middleware/requestTracing');
const stabilizationRequestLogger = require('./middleware/stabilizationRequestLogger');
const { shadowMirrorMiddleware } = require('./middleware/shadowMirrorMiddleware');
const externalProbeController = require('./controllers/externalProbeController');
const warmupService = require('./services/warmupService');
const prisma = require('./lib/prisma');
const logger = require('./utils/logger');
const socketModule = require('./socket');
const { authenticateToken, isAdmin } = require('./middleware/auth');

const app = express();

// 🛡️ Sentry Tracing is automatic in v8+ when initialized
const server = http.createServer(app);

// 🛡️ [SEC-FIX] Trust Proxy Configuration
// Enable trusting the immediate proxy (like Nginx/Vite/loopback) to get the real client IP
app.set('trust proxy', 1);

async function startServer() {
  try {
    // 3. Initialize Distributed Services
    const cacheService = require('./services/cacheService');
    const happyHourService = require('./services/happyHourService');
    
    const io = socketModule.init(server);
    happyHourService.setIO(io);

    if (process.env.NODE_ENV !== 'test') {
      await Promise.all([
        happyHourService.initialize()
      ]);
    }
    
    logger.info('🚀 Systems Initialized: Cache, Socket, HappyHour');

    if (process.env.NODE_ENV !== 'test') {
      // 2. 🚀 Initialize Event-Driven Architecture (AWAITED)
      const eventSystem = require('./events/init');
      await eventSystem.init();

      // 3. Start Background Workers
      initCronJobs(io);
      const { startArchiverCron } = require('./jobs/dailyArchiver');
      startArchiverCron();
      initOrderWorker(io);
      initHealthWorker().catch(err => logger.error('[Startup] Health Worker failed', { error: err.message }));
    }

    // 4. Register Middleware
    const performanceMonitor = require('./middleware/performanceMonitor');
    app.use(requestTracing);
    app.use(stabilizationRequestLogger);
    app.use(performanceMonitor);
    if (process.env.NODE_ENV !== 'production') {
      app.use(shadowMirrorMiddleware);
    }
    
    // Inject service container into all requests for controller dependency injection
    const container = require('./lib/container');
    app.use((req, res, next) => {
      req.container = container;
      next();
    });
    
    app.use(helmet({ 
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"], 
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "blob:", "https://*.cloudinary.com", "https://*.googleusercontent.com"], 
          connectSrc: ["'self'", "wss:", "ws:"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
          baseUri: ["'self'"],
          formAction: ["'self'"]
        }
      }
    }));
    
    // ⏱️ [SEC-FIX] Robust Request Timeout
    app.use(timeout('30s'));
    app.use((req, res, next) => {
      if (!req.timedout) next();
    });
    
    app.use(cookieParser());
    
    // 🛡️ CSRF Protection (Custom Lightweight Double Cookie Submit Injector)
    app.use((req, res, next) => {
      // Ensure XSRF-TOKEN cookie exists. If not, generate a new secure random token.
      let xsrfToken = req.cookies?.['XSRF-TOKEN'];
      if (!xsrfToken) {
        const crypto = require('crypto');
        xsrfToken = crypto.randomBytes(24).toString('hex');
        
        const isProd = process.env.NODE_ENV === 'production';
        const sameSite = isProd ? 'none' : 'lax';
        const secure = isProd || req.secure || req.headers['x-forwarded-proto'] === 'https';
        
        res.cookie('XSRF-TOKEN', xsrfToken, {
          secure,
          sameSite,
          path: '/',
          httpOnly: false // 🔓 Allow client-side JS to read this cookie to set the X-XSRF-TOKEN header
        });
      }
      next();
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
        if (!origin) return callback(null, true);
        // Only allow localhost origins in development — production uses allowedOriginRegexes
        const isLocal = process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
        const isAllowed = allowedOriginRegexes.some(regex => regex.test(origin));
        if (isLocal || isAllowed) callback(null, true);
        else callback(new Error('Not allowed by CORS'), false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Correlation-ID', 'X-Request-Id', 'idempotency-key', 'X-XSRF-TOKEN', 'x-branch-context']
    }));

    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    app.use(morgan('combined', { stream: { write: message => logger.http(message.trim()) } }));
    const sanitizeBranchId = require('./middleware/sanitizeBranchId');
    app.use(sanitizeBranchId);

    // ⏱️ Request Timeout Hardening
    app.use((req, res, next) => {
      req.setTimeout(25000); // 25 seconds max
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
    const { authenticateToken } = require('./middleware/auth');
    app.use('/uploads', authenticateToken, (req, res, next) => {
      if (!/\.(webp|jpeg|jpg|png)$/i.test(req.path)) {
        return res.status(403).end();
      }
      next();
    }, express.static(path.join(__dirname, '../uploads')));

    // 🕵️ System Audit (Sensitive Routes)
    const auditMiddleware = require('./middleware/auditMiddleware');
    app.use(auditMiddleware);

    // ─── API Deprecation Policy (Lifecycle Management) ───────
    const deprecation = require('./middleware/deprecation');
    app.use((req, res, next) => {
      const isVersioned = req.path.startsWith('/api/v1');
      const isApi = req.path.startsWith('/api');
      const isInternal = req.path.startsWith('/uploads') || 
                        req.path.startsWith('/socket.io') || 
                        req.path === '/health/external';

      if (isApi && !isVersioned && !isInternal) {
        return deprecation({
          alternative: `/api/v1${req.path}`,
          date: '2026-12-31' // End of support for legacy endpoints
        })(req, res, next);
      }
      next();
    });

    // ─── API Routes (Versioned) ──────────────────────────────
    // 🛡️ Canonical API path — all clients MUST use /api/v1/
    app.use('/api/v1', apiV1Router);

    // 📖 API Documentation (Swagger) — Protected in Production
    const { swaggerUi, specs } = require('./config/swagger');
    const swaggerHandler = swaggerUi.serve;
    const swaggerSetup = swaggerUi.setup(specs, {
      swaggerOptions: { persistAuthorization: true },
      customSiteTitle: "Al Markazia API Docs"
    });

    if (process.env.NODE_ENV === 'production') {
      app.use('/api-docs', authenticateToken, isAdmin, swaggerHandler, swaggerSetup);
    } else {
      app.use('/api-docs', swaggerHandler, swaggerSetup);
    }

    // Health Checks (external probes — always at root)
    app.get('/health/external', externalProbeController.pings);

    // ─── Serve Admin Panel (SPA static files) ────────────────
    app.use(express.static(path.join(__dirname, '../public_admin')));

    // SPA Fallback: Redirect all non-API, non-internal requests to index.html
    app.get('*all', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path.startsWith('/uploads')) {
        return next();
      }
      res.sendFile(path.join(__dirname, '../public_admin/index.html'));
    });


    // 🚨 Global Error Handler (Centralized Survival Layer)
    const { handleError } = require('./utils/errorHandler');
    
    // 🛡️ Sentry Error Handler (v8+ API)
    if (Sentry) {
      Sentry.setupExpressErrorHandler(app);
    }

    app.use((err, req, res, next) => {
      handleError(err, req, res, next);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', { promise, reason });
    });

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception thrown:', { error: err.message, stack: err.stack });
      process.exit(1);
    });

    const PORT = parseInt(process.env.PORT || 5000, 10);

    // Set a flag to signal that the server is importing test files, avoiding dynamic Jest describe/test additions
    process.env.IS_RUNNING_SERVER = 'true';

    // 🚀 Execute heavy DB rehydration BEFORE accepting incoming socket/HTTP traffic
    const { runIntegrityTests } = require('./tests/financialIntegrity');
    const integrityPassed = runIntegrityTests();
    if (!integrityPassed) {
      logger.warn('🧪 Safety Alert: System started with financial integrity warnings.');
    }

    if (process.env.NODE_ENV !== 'test') {
      server.listen(PORT, '0.0.0.0', async () => {
        logger.info(`🚀 Backend Server is running on http://0.0.0.0:${PORT} — accepting connections.`);

        // 🔄 Background Rehydration: Runs in a non-blocking way to keep login responsive
        // We use setImmediate to ensure the listen callback finishes and the event loop yields
        setImmediate(async () => {
          const analyticsProjection = require('./projections/analyticsProjection');
          const orderProjection = require('./projections/orderProjection');
          const SecurityPolicyService = require('./services/securityPolicyService');

          try {
            logger.info('[BackgroundSync] Starting system rehydration...');
            const rehydrationStart = Date.now();
            
            const { traceContext } = require('./utils/context');
            await traceContext.run({ bypassRls: true }, async () => {
              await orderProjection.replay();
              await new Promise(resolve => setTimeout(resolve, 500));
              await analyticsProjection.replay();
              await new Promise(resolve => setTimeout(resolve, 500));
              await SecurityPolicyService.warmupSecurityCache();
            });
            
            logger.info(`🚀 [Rehydration] Total: ${Date.now() - rehydrationStart}ms`);
            logger.info('✅ Background rehydration complete — system fully primed.');
          } catch (e) {
            logger.error('Rehydration Failed', { error: e.message });
          }

          // 🏭 Start Stream Consumer Group Workers (after rehydration)
          try {
            const { startWorkers } = require('./workers/workerRegistry');
            await startWorkers();
          } catch (e) {
            logger.error('[WorkerRegistry] Failed to start workers', { error: e.message });
          }

          // 🚀 Deferred Warmup to ensure instant API availability
          setTimeout(() => {
            warmupService.run().catch(e => logger.error('Warmup Error', { error: e.message }));
          }, 5000);
        });

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
    } else {
      logger.info('🧪 [Startup] Bypassed TCP port binding and background rehydration in Jest test mode.');
    }

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
    const redis = require('./lib/redis');

    await Promise.all([
      prisma.$disconnect(),
      cacheService.destroy(),
      happyHourService.destroy(),
      auditService.destroy(),
      redis.quitAll(),
      new Promise(resolve => setTimeout(resolve, 1500)) // Final grace period
    ]);

    // 5. Stop stream workers cleanly
    try {
      const { stopWorkers } = require('./workers/workerRegistry');
      stopWorkers();
    } catch (e) { /* Workers may not have started yet */ }
    
    logger.info('All services (DB, Cache, HappyHour, Audit, Redis, Workers) disconnected safely.');

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
  logger.error('FATAL STARTUP ERROR', { error: err.message, stack: err.stack });
  process.exit(1);
});

module.exports = app;