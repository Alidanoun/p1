const SOFT_DELETE_MODELS = [
  'FinancialLedger', 'LoyaltyLedger', 'SystemAuditLog', 'Order'
];

exports.applySoftDeleteFilter = (prisma) => {
  prisma.$use(async (params, next) => {
    // 🛡️ Admin bypass or skip soft delete filter
    if (params.args && params.args.skipSoftDelete) {
      delete params.args.skipSoftDelete;
      return next(params);
    }

    // 🔍 Automatically append isDeleted: false on find operations
    if (SOFT_DELETE_MODELS.includes(params.model)) {
      if (['findUnique', 'findFirst', 'findMany', 'count'].includes(params.action)) {
        params.args = params.args || {};
        params.args.where = params.args.where || {};
        params.args.where.isDeleted = false;
      }
    }
    return next(params);
  });
};
