const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } = require('@opentelemetry/sdk-trace-base');

/**
 * 📡 OpenTelemetry Bootstrapper
 * Orchestrates distributed tracing for the Al-Markazia ecosystem.
 */
const sdk = new NodeSDK({
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(0.2), // Sample 20% of root traces in production
  }),
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'al-markazia-backend',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development'
  }),
  spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter({
    // Optional: Point to an OTel collector (e.g., Jaeger, Zipkin, or SigNoz)
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  })),
  instrumentations: [
    getNodeAutoInstrumentations({
      // 🛡️ Disable noisy instrumentations
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
    })
  ]
});

// Start the SDK
try {
  sdk.start();
  console.log('📡 [OTel] OpenTelemetry SDK initialized successfully');
} catch (error) {
  console.error('❌ [OTel] Error initializing OpenTelemetry SDK:', error);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('📡 [OTel] OpenTelemetry SDK shut down'))
    .catch((error) => console.error('❌ [OTel] Error shutting down OTel SDK:', error))
    .finally(() => process.exit(0));
});

module.exports = sdk;
