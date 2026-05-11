const { v7: uuidv7 } = require('uuid');
const { ulid } = require('ulid');

/**
 * 🆔 Canonical ID Generator
 * Implements Phase 0 Strategic ID Policy.
 */
const idGenerator = {
  /**
   * Generates a time-ordered UUID v7.
   * Best for Database Primary Keys (Orders, Customers).
   */
  generateEntityId: () => uuidv7(),

  /**
   * Generates a lexicographically sortable ULID.
   * Best for Events and Log entries.
   */
  generateEventId: () => ulid(),

  /**
   * Generates a short, human-readable trace ID for correlation.
   */
  generateTraceId: () => Math.random().toString(36).substring(2, 15).toUpperCase()
};

module.exports = idGenerator;
