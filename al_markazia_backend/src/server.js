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
const queryProfiler = require('./middleware/queryProfiler');

// Initialize Intelligence & Alerting Layer
require('./services/alertService');

const app = express();
const server = http.createServer(app);
const io = require('./socket').init(server);

// 🚀 Initialize Event-Driven Architecture (Event Sourcing)
// We await this to ensure all handlers are ready before server accepts traffic
const eventSystem = require('./events/init');
eventSystem.init();

// Start Automated Maintenance (Archiving & Cleanup)
initCronJobs(io);

// Start Persistent Order Worker
initOrderWorker(io);

// Start Resilient Health Monitoring Worker
initHealthWorker();

// CRM Tracing & Architecture Layers
app.use(requestTracing);
app.use(shadowMirrorMiddleware); // 🪞 Big Tech Traffic Mirroring

// 🔍 Performance Monitoring (Dev only)
if (process.env.NODE_ENV !== 'production') {
  app.use(queryProfiler(prisma));
}

const PORT = process.env.PORT || 5000;

// 0️⃣ Security Headers (Hardened)
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// 1️⃣ Rate Limiter (First line of defense)
const { globalLimiter, authLimiter, orderLimiter } = require('./middleware/rateLimiter');
app.use(globalLimiter);

app.use(cookieParser());

// 2️⃣ CORS & Body Parsers
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // 🛡️ Explicit Origins for Credentials-based Auth
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // 🚀 Improvement: Return false instead of Error to avoid 500 crashes
      callback(null, false);
    }
  },
  credentials: true, // ✅ Required for HttpOnly Cookies
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const logger = require('./utils/logger');

// Morgan Integration (HTTP Request Logging)
// Skip logging for health status
const skipFormats = (req, res) => {
  if (req.originalUrl === '/health') return true;
  if (process.env.NODE_ENV === 'production') {
    return res.statusCode < 400; // Only log 4xx and 5xx in prod
  }
  return false; // Log all in dev
};

// Custom format to include useful data
morgan.token('client-ip', (req) => req.ip || req.connection.remoteAddress);

app.use(morgan(
  ':client-ip - :method :url :status - :response-time ms',
  {
    stream: {
      write: (message) => logger.http(message.trim())
    },
    skip: skipFormats
  }
));

// 🛡️ Secure Static File Serving (V21 Hardened)
app.use('/uploads', express.static('uploads', {
  maxAge: '7d',
  immutable: true,
  index: false,
  dotfiles: 'deny',
  setHeaders: (res) => {
    // Prevent MIME-sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Ensure inline display instead of forced download
    res.setHeader('Content-Disposition', 'inline');
    // Basic CSP for assets
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  }
}));

// BullMQ Monitoring Dashboard (Secured with Admin Key)
app.use('/admin/queues', (req, res, next) => {
  const adminKey = req.headers['x-admin-key'] || req.query.key;
  if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
    logger.warn('Unauthorized access attempt to Bull Board', { ip: req.ip });
    return res.status(403).send('Forbidden: Admin Key Required');
  }
  next();
}, setupQueueDashboard());

// 4️⃣ API Routes
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
app.get('/health/external', externalProbeController.pings);

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error(err.message, { 
    method: req.method, 
    endpoint: req.originalUrl, 
    stack: err.stack 
  });
  res.status(500).json({ error: 'حدث خطأ غير متوقع، يرجى المحاولة لاحقاً' });
});

// Process Level Interceptors
process.on('uncaughtException', (err) => {
  logger.error(`UNCAUGHT EXCEPTION: ${err.message}`, { stack: err.stack });
  // Graceful shutdown strategy
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`UNHANDLED REJECTION: ${reason}`, { reason });
  setTimeout(() => process.exit(1), 1000);
});

// --- Graceful Shutdown ---
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  
  // Close Socket.io
  if (io) {
    io.close();
    logger.info('Socket.io server closed.');
  }

  // Close Server
  server.close(async () => {
    logger.info('HTTP server closed.');
    
    try {
      // Disconnect Prisma
      const prisma = require('./lib/prisma');
      await prisma.$disconnect();
      logger.info('Prisma disconnected.');

      // Close BullMQ Queues/Workers
      const { orderQueue } = require('./queues/orderQueue');
      await orderQueue.close();
      logger.info('Order queue closed.');

      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { error: err.message });
      process.exit(1);
    }
  });

  // Force exit after 10s if shutdown hangs
  setTimeout(() => {
    logger.error('Shutdown timed out, forcing exit.');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

io.on('connection', (socket) => {
  const { SOCKET_ROOMS, ROLES } = require('./shared/socketEvents');
  
  // --- 📡 DETERMINISTIC ROOM MANAGEMENT ---
  // Every socket MUST join its primary identity room immediately
  
  // 1. Identity Routing
  if (socket.user.role === ROLES.ADMIN || socket.user.role === ROLES.SUPER_ADMIN) {
    socket.join(SOCKET_ROOMS.ADMIN);
    socket.join(SOCKET_ROOMS.DASHBOARD); // Admins also see metrics
    logger.info('Admin routed to core rooms', { userId: socket.user.id });
  } else {
    const customerRoom = SOCKET_ROOMS.CUSTOMER(socket.user.id);
    socket.join(customerRoom);
    logger.info('Customer routed to private room', { userId: socket.user.id, room: customerRoom });
  }

  // 2. Client-Requested Join Handlers (Redundant but kept for manual UI transitions)
  socket.on('join:admin', () => {
    if ([ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(socket.user.role)) {
      socket.join(SOCKET_ROOMS.ADMIN);
    }
  });

  socket.on('join:dashboard', () => {
    if ([ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(socket.user.role)) {
      socket.join(SOCKET_ROOMS.DASHBOARD);
    }
  });

  socket.on('disconnect', () => {
    if (socket.user) {
      logger.info('Socket session ended', { userId: socket.user.id });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const host = process.env.HOST_IP || 'localhost';
  logger.info(`🚀 Backend Server is running on http://${host}:${PORT}`);
  logger.info(`📡 Socket.io initialized and listening for events`);
  
  // ⚡ Big Tech Predictive Warmup
  warmupService.run().catch(e => logger.error('Warmup Background Error', { error: e.message }));
});
