/**
 * 🤖 System Identity Registry
 * Centralized context for background workers and internal processes.
 */

const SYSTEM_USERS = {
  WORKER: {
    id: 0,
    uuid: 'system-worker-0000',
    role: 'admin',
    email: 'system-worker@almarkazia.com',
    name: 'Auto-Accept Worker'
  },
  CRON: {
    id: -1,
    uuid: 'system-cron-0000',
    role: 'admin',
    email: 'system-cron@almarkazia.com',
    name: 'Maintenance Job'
  }
};

module.exports = { SYSTEM_USERS };
