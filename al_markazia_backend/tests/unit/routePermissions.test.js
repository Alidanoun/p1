const apiV1Router = require('../../src/routes/index');

const PERMISSION_TO_MODULE = {
  'order:view': 'liveOrders',
  'order:update_status': 'manageOrders',
  'order:cancel': 'manageOrders',
  'order:manage_timer': 'manageOrders',
  'order:partial_cancel': 'manageOrders',
  'financial:view_reports': 'financials',
  'financial:approve_refund': 'financials',
  'financial:manage_ledger': 'financials',
  'catalog:manage': 'menu',
  'catalog:view': 'menu',
  'system:config_manage': 'settings',
  'system:view_logs': 'settings',
  'branch:manage': 'branch',
  'branch:view': 'branch',
  'crm:view': 'crm',
  'crm:edit': 'crm'
};

function flattenRoutes(router, prefix = '') {
  const routes = [];
  if (!router || !router.stack) return routes;

  router.stack.forEach((layer) => {
    if (layer.route) {
      // It's a route
      const path = prefix + layer.route.path;
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
      const middlewares = layer.route.stack.map(s => s.handle);
      methods.forEach((method) => {
        routes.push({ path, method, middlewares });
      });
    } else if (layer.name === 'router' && layer.handle) {
      // It's a nested router
      let routePrefix = prefix;
      if (layer.regexp) {
        // Try to reconstruct the prefix from regexp if possible, or use path from keys
        const match = layer.regexp.toString().match(/^\/\^\\(\/\w+)\\\/\?/);
        if (match && match[1]) {
          routePrefix += match[1];
        }
      }
      routes.push(...flattenRoutes(layer.handle, routePrefix));
    }
  });

  return routes;
}

describe('Automated Route Permissions Check', () => {
  test('every route with hasPermission must also call checkPermission with correct module', () => {
    const routes = flattenRoutes(apiV1Router);
    const violations = [];

    routes.forEach(({ path, method, middlewares }) => {
      let hasPermissionMeta = null;
      let checkPermissionMeta = null;

      middlewares.forEach((mw) => {
        if (mw && mw.metadata) {
          if (mw.metadata.isHasPermission) {
            hasPermissionMeta = mw.metadata;
          }
          if (mw.metadata.isCheckPermission) {
            checkPermissionMeta = mw.metadata;
          }
        }
      });

      if (hasPermissionMeta) {
        const permission = hasPermissionMeta.permission;

        // Skip order:view_own since it uses verifyOrderOwnership (direct customer ownership)
        if (permission === 'order:view_own') {
          return;
        }

        const expectedModule = PERMISSION_TO_MODULE[permission];
        if (!expectedModule) {
          violations.push(`[UNMAPPED_PERMISSION] Route ${method} ${path} uses unmapped permission: "${permission}"`);
          return;
        }

        if (!checkPermissionMeta) {
          violations.push(`[MISSING_CHECK_PERMISSION] Route ${method} ${path} has hasPermission("${permission}") but is missing checkPermission()`);
          return;
        }

        if (checkPermissionMeta.module !== expectedModule) {
          violations.push(`[MODULE_MISMATCH] Route ${method} ${path} expected checkPermission("${expectedModule}") for permission "${permission}", but got checkPermission("${checkPermissionMeta.module}")`);
        }
      }
    });

    if (violations.length > 0) {
      throw new Error(`Route Permission Enforcement failed with ${violations.length} violations:\n` + violations.join('\n'));
    }
  });
});
