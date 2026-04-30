const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
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
const deliveryZoneRoutes = require('./routes/deliveryZones');
const dashboardRoutes = require('./routes/dashboard');
const healthRoutes = require('./routes/health');
const restaurantRoutes = require('./routes/restaurant');
const loyaltyRoutes = require('./routes/loyalty');
const orderModificationRoutes = require('./routes/orderModifications');

const http = require('http');
const { initCronJobs } = require('./jobs/cronJobs');
const { initOrderWorker, setupQueueDashboard } = require('./queues/orderQueue');
const { initHealthWorker } = require('./queues/healthWorker');
const { requestTracing } = require('./middleware/requestTracing');
const { governorGuard } = require('./middleware/governorMiddleware');
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
    // 1. Initialize Socket.IO
    const io = socketModule.init(server);

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
    app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
    
    const { globalLimiter } = require('./middleware/rateLimiter');
    app.use(globalLimiter);
    app.use(cookieParser());
    
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

    app.use(express.json({ limit: '50kb' }));
    app.use(express.urlencoded({ extended: true, limit: '50kb' }));

    // HTTP Logging
    morgan.token('client-ip', (req) => req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress);
    
    app.use(morgan(':client-ip - :method :url :status - :response-time ms', {
      stream: { write: (message) => logger.http(message.trim()) },
      skip: (req, res) => req.originalUrl === '/health' || (process.env.NODE_ENV === 'production' && res.statusCode < 400)
    }));

    // Routes
    app.use('/auth', governorGuard('MISSION_CRITICAL'), IdempotencyService.guard(), authRoutes);
    app.use('/items', itemRoutes);
    app.use('/orders', governorGuard('MISSION_CRITICAL'), IdempotencyService.guard(), orderRoutes);
    app.use('/categories', categoryRoutes);
    app.use('/notifications', notificationRoutes);
    app.use('/customers', customerRoutes);
    app.use('/reviews', governorGuard('AUXILIARY'), reviewRoutes);
    app.use('/settings', settingsRoutes);
    app.use('/metrics', metricsRoutes);
    app.use('/analytics', governorGuard('AUXILIARY'), analyticsRoutes);
    app.use('/system', systemRoutes);
    app.use('/delivery-zones', deliveryZoneRoutes);
    app.use('/dashboard', dashboardRoutes);
    app.use('/health', healthRoutes);
    app.use('/restaurant', restaurantRoutes);
    app.use('/loyalty', loyaltyRoutes);
    app.use('/order-modifications', governorGuard('MISSION_CRITICAL'), IdempotencyService.guard(), orderModificationRoutes);
    app.get('/health/external', externalProbeController.pings);

    // Global Error Handler
    app.use((err, req, res, next) => {
      logger.error(err.message, { method: req.method, endpoint: req.originalUrl, stack: err.stack });
      res.status(500).json({ error: 'حدث خطأ غير متوقع، يرجى المحاولة لاحقاً' });
    });

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, '0.0.0.0', async () => {
      logger.info(`🚀 Backend Server is running on port ${PORT}`);
      
      // Post-startup Warmup
      warmupService.run().catch(e => logger.error('Warmup Error', { error: e.message }));
      
      const analyticsProjection = require('./projections/analyticsProjection');
      const orderProjection = require('./projections/orderProjection');
      await Promise.all([analyticsProjection.replay(), orderProjection.replay()])
        .catch(e => logger.error('Rehydration Failed', { error: e.message }));
    });

  } catch (err) {
    logger.error('❌ CRITICAL STARTUP FAILURE', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

// Global Process Handlers
process.on('uncaughtException', (err) => {
  logger.error(`UNCAUGHT EXCEPTION: ${err.message}`, { stack: err.stack });
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`UNHANDLED REJECTION: ${reason}`);
  setTimeout(() => process.exit(1), 1000);
});

startServer();
