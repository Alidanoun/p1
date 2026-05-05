const express = require('express'); // Heartbeat: 2026-05-02 01:57
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const csrf = require('csurf');
const timeout = require('connect-timeout');
const morgan = require('morgan');
require('dotenv').config();
require('./config/secrets');

const authRoutes = require('./routes/auth');
const itemRoutes = require('./routes/items');
const orderRoutes = require('./routes/orders');
const categoryRoutes = require('./routes/categories');
const notificationRoutes = require('./routes/notifications');
const customerRoutes = require('./routes/customers');
const reviewRoutes = require('./routes/reviews');
const settingsRoutes = require('./routes/settings');
const metricsRoutes = require('./routes/metrics');
const analyticsRoutes = require('./routes/analytics');
const systemRoutes = require('./routes/system');
const happyHourRoutes = require('./routes/happyHour');
const { governorGuard } = require('./middleware/securityGuard');
const deliveryZoneRoutes = require('./routes/deliveryZones');
const dashboardRoutes = require('./routes/dashboard');
const healthRoutes = require('./routes/health');
const restaurantRoutes = require('./routes/restaurant');
const loyaltyRoutes = require('./routes/loyalty');
const orderModificationRoutes = require('./routes/orderModifications');
const branchRoutes = require('./routes/branch');

const http = require('http');
const net = require('net');
const os = require('os');
const { initCronJobs } = require('./jobs/cronJobs');
const { initOrderWorker, setupQueueDashboard } = require('./queues/orderQueue');
const { initHealthWorker } = require('./queues/healthWorker');
const { requestTracing } = require('./middleware/requestTracing');
const { shadowMirrorMiddleware } = require('./middleware/shadowMirrorMiddleware');
const IdempotencyService = require('./services/idempotencyService');
const externalProbeController = require('./controllers/externalProbeController');
const warmupService = require('./services/warmupService');
const prisma = require('./lib/prisma');
const logger = require('./utils/logger');
const socketModule = require('./socket');

const app = express();
const server = http.createServer(app);

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
    app.use(requestTracing);
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
      const isAuthRoute = req.path.startsWith('/auth') || req.path.startsWith('/api/auth');
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
    app.use(cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        
        // Auto-allow Localhost/127.0.0.1 for development comfort
        const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('192.168.');
        if (isLocal || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
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

    // Routes
    app.use('/auth', governorGuard('MISSION_CRITICAL'), authRoutes);
    app.use('/items', itemRoutes);
    app.use('/admin/audit', require('./routes/audit'));
    app.use('/api/analytics', analyticsRoutes);
    app.use('/orders', governorGuard('MISSION_CRITICAL'), IdempotencyService.guard(), orderRoutes);
    app.use('/categories', categoryRoutes);
    app.use('/notifications', notificationRoutes);
    app.use('/customers', customerRoutes);
    app.use('/reviews', governorGuard('AUXILIARY'), reviewRoutes);
    app.use('/settings', settingsRoutes);
    app.use('/metrics', metricsRoutes);
    app.use('/api/system', systemRoutes);
    app.use('/api/happyhour', happyHourRoutes);
    
    app.get('/health', (req, res) => res.status(200).json({ status: 'ok', timestamp: new Date() }));
    app.use('/delivery-zones', deliveryZoneRoutes);
    app.use('/dashboard', dashboardRoutes);
    const financialRoutes = require('./routes/financial');

    // API Routes
    app.use('/api/financial', financialRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/restaurant', restaurantRoutes);
    app.use('/loyalty', loyaltyRoutes);
    app.use('/order-modifications', governorGuard('MISSION_CRITICAL'), IdempotencyService.guard(), orderModificationRoutes);
    app.use('/branch', branchRoutes);
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
  }, 10000);

  try {
    // 1. Close HTTP Server (Stop accepting new requests)
    server.close(() => {
      logger.info('HTTP server closed.');
    });

    // 2. Disconnect from DB & Cache
    const cacheService = require('./services/cacheService');
    const happyHourService = require('./services/happyHourService');
    await Promise.all([
      prisma.$disconnect(),
      cacheService.destroy(),
      happyHourService.destroy()
    ]);
    logger.info('DB, Cache and HappyHour disconnected.');

    clearTimeout(timeoutGuard);
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer();
