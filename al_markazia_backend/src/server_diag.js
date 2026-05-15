// require('./lib/otel');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const csrf = require('csurf');
const timeout = require('connect-timeout');
const morgan = require('morgan');
require('dotenv').config();
require('./config/secrets');
const { initSentry, Sentry } = require('./config/sentry');

initSentry();

process.on('uncaughtException', (err) => {
  console.error('CRITICAL UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const apiV1Router = require('./routes/index');
const http = require('http');
const { initCronJobs } = require('./jobs/cronJobs');
const { requestTracing } = require('./middleware/requestTracing');
const prisma = require('./lib/prisma');
const logger = require('./utils/logger');
const response = require('./utils/response');

const app = express();
const server = http.createServer(app);

app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

app.use('/api/v1', apiV1Router);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  logger.info(`🚀 Diagnostic Server running on port ${PORT}`);
});
