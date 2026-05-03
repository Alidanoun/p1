-- ⚡ Performance Indexes

-- Branch-related queries
CREATE INDEX IF NOT EXISTS idx_branch_items_branch_id 
ON "BranchItem"("branchId");

CREATE INDEX IF NOT EXISTS idx_branch_items_item_id 
ON "BranchItem"("itemId");

CREATE INDEX IF NOT EXISTS idx_branch_items_available 
ON "BranchItem"("branchId", "isAvailable");

-- Order queries
CREATE INDEX IF NOT EXISTS idx_orders_branch_id_status 
ON "Order"("branchId", "status");

CREATE INDEX IF NOT EXISTS idx_orders_created_at 
ON "Order"("createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_orders_branch_created 
ON "Order"("branchId", "createdAt" DESC);

-- User queries
CREATE INDEX IF NOT EXISTS idx_users_branch_id_role 
ON "User"("branchId", "role");

CREATE INDEX IF NOT EXISTS idx_users_email 
ON "User"("email");

-- Session queries
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id 
ON "RefreshToken"("userId");

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_jti 
ON "RefreshToken"("jti");

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires 
ON "RefreshToken"("expiresAt");

-- Audit logs
CREATE INDEX IF NOT EXISTS idx_audit_user_id_created 
ON "SystemAuditLog"("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_audit_action_created 
ON "SystemAuditLog"("action", "createdAt" DESC);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_read 
ON "Notification"("userId", "isRead");

-- OTP codes
CREATE INDEX IF NOT EXISTS idx_otp_email_purpose 
ON "OtpCode"("email", "purpose", "used");
