-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'BRANCH_MANAGER', 'MANAGER', 'STAFF', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('NONE', 'VIEW', 'EDIT_PIN', 'EDIT_PIN_READ', 'FULL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'DELIVERED', 'READ');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('normal', 'pending_partial_cancel', 'cancelled', 'rejected', 'pending_customer_resolution', 'pending_replacement_approval');

-- CreateEnum
CREATE TYPE "FinancialApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "emailHash" TEXT,
    "phone" TEXT,
    "phoneHash" TEXT,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fcmToken" TEXT,
    "uuid" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "authVersion" INTEGER NOT NULL DEFAULT 1,
    "permissionVersion" INTEGER NOT NULL DEFAULT 1,
    "sessionEpoch" INTEGER NOT NULL DEFAULT 1,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockUntil" TIMESTAMP(3),
    "branchId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "quietHoursStart" INTEGER NOT NULL DEFAULT 23,
    "quietHoursEnd" INTEGER NOT NULL DEFAULT 7,
    "pinHash" TEXT,
    "plainPin" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotificationPreference" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBranch" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "country" TEXT DEFAULT 'JO',
    "timezone" TEXT DEFAULT 'Africa/Cairo',
    "isEmergencyClosed" BOOLEAN NOT NULL DEFAULT false,
    "closureReason" TEXT,
    "reopenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "visibleInApp" BOOLEAN NOT NULL DEFAULT true,
    "appDisplayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchPermissions" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "liveOrders" "PermissionLevel" NOT NULL DEFAULT 'FULL',
    "manageOrders" "PermissionLevel" NOT NULL DEFAULT 'FULL',
    "menu" "PermissionLevel" NOT NULL DEFAULT 'FULL',
    "notifications" "PermissionLevel" NOT NULL DEFAULT 'FULL',
    "reviews" "PermissionLevel" NOT NULL DEFAULT 'VIEW',
    "loyalty" "PermissionLevel" NOT NULL DEFAULT 'VIEW',
    "rewardsStore" "PermissionLevel" NOT NULL DEFAULT 'NONE',
    "advancedAnalytics" "PermissionLevel" NOT NULL DEFAULT 'VIEW',
    "financials" "PermissionLevel" NOT NULL DEFAULT 'VIEW',
    "deliveryZones" "PermissionLevel" NOT NULL DEFAULT 'EDIT_PIN',
    "auditLog" "PermissionLevel" NOT NULL DEFAULT 'VIEW',
    "settings" "PermissionLevel" NOT NULL DEFAULT 'EDIT_PIN',
    "canToggleLiveMode" BOOLEAN NOT NULL DEFAULT false,
    "canModifyWorkHours" "PermissionLevel" NOT NULL DEFAULT 'EDIT_PIN',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "BranchPermissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchItem" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "stockCount" INTEGER NOT NULL DEFAULT -1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchVariant" (
    "id" SERIAL NOT NULL,
    "branchId" TEXT NOT NULL,
    "variantId" INTEGER NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "description" TEXT,
    "descriptionEn" TEXT,
    "image" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "titleEn" TEXT,
    "description" TEXT,
    "descriptionEn" TEXT,
    "basePrice" DECIMAL(10,2) NOT NULL,
    "image" TEXT,
    "categoryId" INTEGER NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "preparationTime" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "cachedAvgRating" DOUBLE PRECISION DEFAULT 0,
    "cachedReviewCount" INTEGER DEFAULT 0,
    "excludeFromStats" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "isGlobal" BOOLEAN NOT NULL DEFAULT true,
    "availabilitySchedule" JSONB,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemVariant" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "priceDiff" DECIMAL(10,2) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ItemVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierGroup" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "groupName" TEXT NOT NULL,
    "groupNameEn" TEXT,
    "type" TEXT NOT NULL DEFAULT 'SINGLE',
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "minSelection" INTEGER NOT NULL DEFAULT 0,
    "maxSelection" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemModifier" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ItemModifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerPhoneHash" TEXT,
    "customerNameHash" TEXT,
    "customerId" INTEGER,
    "branchId" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "paymentMethod" TEXT NOT NULL DEFAULT 'cash',
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "modificationStatus" TEXT NOT NULL DEFAULT 'NONE',
    "cancellationFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "address" TEXT,
    "notes" TEXT,
    "estimatedReadyAt" TIMESTAMP(3),
    "estimatedArrivalAt" TIMESTAMP(3),
    "preparationTimeMinutes" INTEGER DEFAULT 20,
    "deliveryTimeMinutes" INTEGER DEFAULT 15,
    "rating" INTEGER,
    "ratingComment" TEXT,
    "isRatingApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "eventSequence" INTEGER NOT NULL DEFAULT 1,
    "previousVersion" INTEGER NOT NULL DEFAULT 0,
    "causedByEventId" TEXT,
    "snapshotEpoch" INTEGER NOT NULL DEFAULT 1,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "pointsAwarded" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deliveryMinOrder" DECIMAL(10,2),
    "deliveryZoneId" TEXT,
    "deliveryZoneName" TEXT,
    "tenantId" TEXT DEFAULT 'default-restaurant',
    "source" TEXT NOT NULL DEFAULT 'app',
    "happyHourId" TEXT,
    "happyHourDiscount" DECIMAL(10,2) DEFAULT 0,
    "happyHourMultiplier" DECIMAL(3,2) DEFAULT 1.0,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateId" INTEGER NOT NULL,
    "aggregateType" TEXT NOT NULL DEFAULT 'order',
    "payload" JSONB NOT NULL,
    "metadata" JSONB,
    "version" INTEGER NOT NULL,
    "tenantId" TEXT DEFAULT 'default-restaurant',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "itemId" INTEGER,
    "itemName" TEXT NOT NULL,
    "itemNameEn" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "selectedOptions" TEXT,
    "selectedOptionsEn" TEXT,
    "lineTotal" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'normal',
    "rejectionReason" TEXT,
    "replacedFromId" INTEGER,
    "originalPriceAtOrder" DECIMAL(10,2),
    "suggestedReplacementItemId" INTEGER,
    "resolutionPreference" TEXT,
    "replacementStatus" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "phoneHash" TEXT,
    "nameHash" TEXT,
    "email" TEXT,
    "emailHash" TEXT,
    "password" TEXT,
    "address" TEXT,
    "fcmToken" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "walletBalance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'SILVER',
    "cancellationCount" INTEGER NOT NULL DEFAULT 0,
    "isBlacklisted" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "blacklistedAt" TIMESTAMP(3),
    "blacklistExpiresAt" TIMESTAMP(3),
    "blacklistReason" TEXT,
    "blacklistReasonCode" TEXT,
    "blacklistSource" TEXT,
    "blacklistedBy" TEXT,
    "blacklistSeverity" TEXT NOT NULL DEFAULT 'LOW',
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "riskScoreUpdatedAt" TIMESTAMP(3),
    "authVersion" INTEGER NOT NULL DEFAULT 1,
    "permissionVersion" INTEGER NOT NULL DEFAULT 1,
    "sessionEpoch" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "username" TEXT,
    "uuid" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockUntil" TIMESTAMP(3),
    "timezone" TEXT DEFAULT 'Africa/Cairo',
    "quietHoursStart" INTEGER NOT NULL DEFAULT 23,
    "quietHoursEnd" INTEGER NOT NULL DEFAULT 7,
    "referralCode" TEXT,
    "referredById" INTEGER,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerNotificationPreference" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CustomerNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL,
    "transactionRef" TEXT,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER,
    "customerPhone" TEXT,
    "title" TEXT NOT NULL,
    "titleEn" TEXT,
    "message" TEXT NOT NULL,
    "messageEn" TEXT,
    "type" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "orderId" INTEGER,
    "targetRoute" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fcmSent" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "metadata" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "socketSent" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "alertType" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(500),
    "status" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "fingerprint" VARCHAR(64),
    "rejectedReason" TEXT,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "branchId" TEXT,
    "driverId" INTEGER,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "isVerifiedPurchase" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reply" (
    "id" SERIAL NOT NULL,
    "reviewId" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "content" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCancellation" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "cancelledBy" TEXT NOT NULL,
    "previousStatus" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rejectionReason" TEXT,
    "adminName" TEXT,
    "refundedAmount" DECIMAL(10,2) DEFAULT 0,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAuditLog" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventAction" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedByRole" TEXT NOT NULL,
    "previousData" TEXT,
    "newData" TEXT,
    "changedFields" TEXT,
    "rejectionReason" TEXT,
    "integrityHash" TEXT,
    "previousHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAuditLogArchive" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventAction" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedByRole" TEXT NOT NULL,
    "previousData" TEXT,
    "newData" TEXT,
    "changedFields" TEXT,
    "rejectionReason" TEXT,
    "integrityHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAuditLogArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "responseCode" INTEGER,
    "responseBody" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" SERIAL NOT NULL,
    "userId" TEXT,
    "customerId" INTEGER,
    "orderId" INTEGER,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "messageId" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAuditLog" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventAction" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedByRole" TEXT NOT NULL,
    "reason" TEXT,
    "previousData" TEXT,
    "newData" TEXT,
    "diff" TEXT,
    "severitySnapshot" TEXT,
    "requestId" TEXT,
    "actionCategory" TEXT NOT NULL DEFAULT 'CUSTOMER_MODERATION',
    "userAgent" TEXT,
    "deviceId" TEXT,
    "requestSource" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryZone" (
    "id" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "fee" DECIMAL(10,2) NOT NULL,
    "minOrder" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "jti" TEXT,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "tokenFamily" TEXT,
    "fingerprint" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthMetric" (
    "id" SERIAL NOT NULL,
    "score" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "services" JSONB NOT NULL,
    "latencies" JSONB NOT NULL,
    "errorRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "phoneHash" TEXT,
    "email" TEXT,
    "emailHash" TEXT,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "purpose" TEXT NOT NULL DEFAULT 'login',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "userRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "ip" TEXT,
    "userAgent" TEXT,
    "branchId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SystemAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Amman',
    "isEmergencyClosed" BOOLEAN NOT NULL DEFAULT false,
    "closureReason" TEXT,
    "reopenAt" TIMESTAMP(3),
    "lastOrderMinutesBeforeClose" INTEGER NOT NULL DEFAULT 15,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkingHour" (
    "id" SERIAL NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openTime" TEXT NOT NULL,
    "closeTime" TEXT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkingHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "pointsPerJod" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "tierGoldMinOrders" INTEGER NOT NULL DEFAULT 10,
    "tierPlatinumMinOrders" INTEGER NOT NULL DEFAULT 25,
    "pointsMultiplierGold" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "pointsMultiplierPlatinum" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "reviewPoints" INTEGER NOT NULL DEFAULT 50,
    "referralPoints" INTEGER NOT NULL DEFAULT 100,
    "socialSharePoints" INTEGER NOT NULL DEFAULT 20,
    "happyHourMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "happyHourStart" TEXT NOT NULL DEFAULT '16:00',
    "happyHourEnd" TEXT NOT NULL DEFAULT '18:00',
    "isHappyHourEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cancellationCompensationRate" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "pointsToJodRate" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "minPointsToRedeem" INTEGER NOT NULL DEFAULT 500,
    "minCompensationPoints" INTEGER NOT NULL DEFAULT 50,
    "rewardExpiryDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialLedger" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER,
    "orderId" INTEGER,
    "branchId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balanceBefore" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "idempotencyKey" TEXT,
    "referenceId" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "FinancialLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialApproval" (
    "id" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "requestedBy" INTEGER NOT NULL,
    "requestedByRole" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "FinancialApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approvedBy" INTEGER,
    "rejectionReason" TEXT,
    "amount" DECIMAL(10,2),
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "ledgerEntryId" INTEGER,
    "branchId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "eventSequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FinancialApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderModificationEvent" (
    "id" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "adminId" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderModificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateId" TEXT,
    "aggregateType" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "eventSequence" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantSubscription" (
    "id" SERIAL NOT NULL,
    "userId" TEXT,
    "fcmToken" TEXT NOT NULL,
    "targetTime" TIMESTAMP(3) NOT NULL,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardItem" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "titleEn" TEXT,
    "description" TEXT,
    "descriptionEn" TEXT,
    "image" TEXT,
    "pointsCost" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "minTier" TEXT NOT NULL DEFAULT 'SILVER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerReward" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "rewardItemId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "CustomerReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchMetric" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "totalOrders" INTEGER NOT NULL,
    "activeOrders" INTEGER NOT NULL,
    "cancellations" INTEGER NOT NULL,
    "revenue" DECIMAL(10,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "eventSequence" INTEGER NOT NULL DEFAULT 1,
    "previousVersion" INTEGER NOT NULL DEFAULT 0,
    "causedByEventId" TEXT,
    "snapshotEpoch" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BranchMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AwardedLoyaltyPoints" (
    "id" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "multiplier" DOUBLE PRECISION NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AwardedLoyaltyPoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyLedger" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "referenceId" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LoyaltyLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyFinancialSnapshot" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "branchId" TEXT NOT NULL,
    "totalRevenue" DECIMAL(10,2) NOT NULL,
    "netRevenue" DECIMAL(10,2) NOT NULL,
    "taxTotal" DECIMAL(10,2) NOT NULL,
    "discountTotal" DECIMAL(10,2) NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "cancelledCount" INTEGER NOT NULL,
    "lossTotal" DECIMAL(10,2) NOT NULL,
    "isFrozen" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyFinancialSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HappyHour" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "discount" INTEGER NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "timezone" TEXT DEFAULT 'Africa/Cairo',
    "eligibilityCriteria" TEXT DEFAULT 'ALL',
    "loyaltyTierRequired" TEXT,
    "targetCustomerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discountType" TEXT DEFAULT 'PERCENTAGE',
    "discountValue" DECIMAL(5,2) DEFAULT 0,
    "rewardMultiplier" DECIMAL(3,2) DEFAULT 1.0,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HappyHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HappyHourLog" (
    "id" TEXT NOT NULL,
    "happyHourId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "discount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HappyHourLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBranchPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "notifications" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBranchPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessPolicy" (
    "id" TEXT NOT NULL,
    "branchId" TEXT,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "BusinessPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "responsePayload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiometricDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BiometricDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'GLOBAL',
    "value" JSONB,
    "businessConfig" JSONB,
    "securityConfig" JSONB,
    "freeCancelWindowMinutes" INTEGER NOT NULL DEFAULT 5,
    "spamCancelLimit" INTEGER NOT NULL DEFAULT 3,
    "spamTimeWindowMinutes" INTEGER NOT NULL DEFAULT 60,
    "defaultDeliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 1.0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponRequest" (
    "id" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "itemPrice" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CouponRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "branchId" TEXT NOT NULL,
    "totalSales" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "cancelledCount" INTEGER NOT NULL DEFAULT 0,
    "avgPrepTime" INTEGER NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_emailHash_key" ON "User"("emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "User_uuid_key" ON "User"("uuid");

-- CreateIndex
CREATE INDEX "User_branchId_idx" ON "User"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotificationPreference_userId_category_key" ON "UserNotificationPreference"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "UserBranch_userId_branchId_key" ON "UserBranch"("userId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BranchPermissions_branchId_key" ON "BranchPermissions"("branchId");

-- CreateIndex
CREATE INDEX "BranchItem_branchId_idx" ON "BranchItem"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchItem_branchId_itemId_key" ON "BranchItem"("branchId", "itemId");

-- CreateIndex
CREATE INDEX "BranchVariant_branchId_idx" ON "BranchVariant"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchVariant_branchId_variantId_key" ON "BranchVariant"("branchId", "variantId");

-- CreateIndex
CREATE INDEX "Item_categoryId_isAvailable_idx" ON "Item"("categoryId", "isAvailable");

-- CreateIndex
CREATE INDEX "Item_isAvailable_createdAt_idx" ON "Item"("isAvailable", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Order_createdAt_status_idx" ON "Order"("createdAt", "status");

-- CreateIndex
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Order_orderNumber_idx" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_tenantId_idx" ON "Order"("tenantId");

-- CreateIndex
CREATE INDEX "Order_branchId_idx" ON "Order"("branchId");

-- CreateIndex
CREATE INDEX "Order_branchId_status_idx" ON "Order"("branchId", "status");

-- CreateIndex
CREATE INDEX "Order_branchId_isDeleted_status_idx" ON "Order"("branchId", "isDeleted", "status");

-- CreateIndex
CREATE INDEX "Event_aggregateId_idx" ON "Event"("aggregateId");

-- CreateIndex
CREATE INDEX "Event_type_idx" ON "Event"("type");

-- CreateIndex
CREATE INDEX "Event_tenantId_idx" ON "Event"("tenantId");

-- CreateIndex
CREATE INDEX "Event_createdAt_idx" ON "Event"("createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_itemId_idx" ON "OrderItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phoneHash_key" ON "Customer"("phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_emailHash_key" ON "Customer"("emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_username_key" ON "Customer"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_uuid_key" ON "Customer"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_referralCode_key" ON "Customer"("referralCode");

-- CreateIndex
CREATE INDEX "Customer_isBlacklisted_idx" ON "Customer"("isBlacklisted");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerNotificationPreference_customerId_category_key" ON "CustomerNotificationPreference"("customerId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Notification_customerId_idx" ON "Notification"("customerId");

-- CreateIndex
CREATE INDEX "Notification_customerPhone_idx" ON "Notification"("customerPhone");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Review_itemId_status_createdAt_idx" ON "Review"("itemId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Review_customerId_createdAt_idx" ON "Review"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_branchId_status_idx" ON "Review"("branchId", "status");

-- CreateIndex
CREATE INDEX "Review_fingerprint_idx" ON "Review"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Review_customerId_orderId_itemId_key" ON "Review"("customerId", "orderId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderCancellation_orderId_key" ON "OrderCancellation"("orderId");

-- CreateIndex
CREATE INDEX "OrderAuditLog_orderId_idx" ON "OrderAuditLog"("orderId");

-- CreateIndex
CREATE INDEX "OrderAuditLog_createdAt_idx" ON "OrderAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "OrderAuditLog_eventType_idx" ON "OrderAuditLog"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_key_key" ON "IdempotencyRecord"("key");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE INDEX "NotificationLog_userId_status_idx" ON "NotificationLog"("userId", "status");

-- CreateIndex
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "CustomerAuditLog_customerId_idx" ON "CustomerAuditLog"("customerId");

-- CreateIndex
CREATE INDEX "CustomerAuditLog_createdAt_idx" ON "CustomerAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryZone_nameAr_key" ON "DeliveryZone"("nameAr");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_jti_key" ON "RefreshToken"("jti");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_token_idx" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_jti_idx" ON "RefreshToken"("jti");

-- CreateIndex
CREATE INDEX "RefreshToken_tokenFamily_idx" ON "RefreshToken"("tokenFamily");

-- CreateIndex
CREATE INDEX "HealthMetric_createdAt_idx" ON "HealthMetric"("createdAt");

-- CreateIndex
CREATE INDEX "HealthMetric_status_idx" ON "HealthMetric"("status");

-- CreateIndex
CREATE INDEX "OtpCode_phone_purpose_used_idx" ON "OtpCode"("phone", "purpose", "used");

-- CreateIndex
CREATE INDEX "OtpCode_email_purpose_used_idx" ON "OtpCode"("email", "purpose", "used");

-- CreateIndex
CREATE INDEX "OtpCode_expiresAt_idx" ON "OtpCode"("expiresAt");

-- CreateIndex
CREATE INDEX "SystemAuditLog_userId_idx" ON "SystemAuditLog"("userId");

-- CreateIndex
CREATE INDEX "SystemAuditLog_action_idx" ON "SystemAuditLog"("action");

-- CreateIndex
CREATE INDEX "SystemAuditLog_branchId_idx" ON "SystemAuditLog"("branchId");

-- CreateIndex
CREATE INDEX "SystemAuditLog_entityType_entityId_idx" ON "SystemAuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "SystemAuditLog_createdAt_idx" ON "SystemAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "SystemAuditLog_isDeleted_idx" ON "SystemAuditLog"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "WorkingHour_dayOfWeek_key" ON "WorkingHour"("dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialLedger_idempotencyKey_key" ON "FinancialLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FinancialLedger_customerId_idx" ON "FinancialLedger"("customerId");

-- CreateIndex
CREATE INDEX "FinancialLedger_orderId_idx" ON "FinancialLedger"("orderId");

-- CreateIndex
CREATE INDEX "FinancialLedger_branchId_idx" ON "FinancialLedger"("branchId");

-- CreateIndex
CREATE INDEX "FinancialLedger_createdAt_idx" ON "FinancialLedger"("createdAt");

-- CreateIndex
CREATE INDEX "FinancialLedger_branchId_type_createdAt_idx" ON "FinancialLedger"("branchId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "FinancialLedger_isDeleted_branchId_idx" ON "FinancialLedger"("isDeleted", "branchId");

-- CreateIndex
CREATE INDEX "FinancialApproval_status_idx" ON "FinancialApproval"("status");

-- CreateIndex
CREATE INDEX "FinancialApproval_operationType_idx" ON "FinancialApproval"("operationType");

-- CreateIndex
CREATE INDEX "FinancialApproval_riskLevel_idx" ON "FinancialApproval"("riskLevel");

-- CreateIndex
CREATE INDEX "OrderModificationEvent_orderId_idx" ON "OrderModificationEvent"("orderId");

-- CreateIndex
CREATE INDEX "OrderModificationEvent_status_idx" ON "OrderModificationEvent"("status");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_createdAt_idx" ON "OutboxEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RestaurantSubscription_notified_targetTime_idx" ON "RestaurantSubscription"("notified", "targetTime");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerReward_code_key" ON "CustomerReward"("code");

-- CreateIndex
CREATE INDEX "CustomerReward_customerId_status_idx" ON "CustomerReward"("customerId", "status");

-- CreateIndex
CREATE INDEX "CustomerReward_code_idx" ON "CustomerReward"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BranchMetric_branchId_key" ON "BranchMetric"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "AwardedLoyaltyPoints_orderId_key" ON "AwardedLoyaltyPoints"("orderId");

-- CreateIndex
CREATE INDEX "AwardedLoyaltyPoints_orderId_idx" ON "AwardedLoyaltyPoints"("orderId");

-- CreateIndex
CREATE INDEX "AwardedLoyaltyPoints_customerId_idx" ON "AwardedLoyaltyPoints"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyLedger_idempotencyKey_key" ON "LoyaltyLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_customerId_createdAt_idx" ON "LoyaltyLedger"("customerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LoyaltyLedger_category_idx" ON "LoyaltyLedger"("category");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_idempotencyKey_idx" ON "LoyaltyLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_isDeleted_idx" ON "LoyaltyLedger"("isDeleted");

-- CreateIndex
CREATE INDEX "DailyFinancialSnapshot_date_idx" ON "DailyFinancialSnapshot"("date");

-- CreateIndex
CREATE INDEX "DailyFinancialSnapshot_branchId_idx" ON "DailyFinancialSnapshot"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyFinancialSnapshot_date_branchId_key" ON "DailyFinancialSnapshot"("date", "branchId");

-- CreateIndex
CREATE INDEX "HappyHour_branchId_isActive_idx" ON "HappyHour"("branchId", "isActive");

-- CreateIndex
CREATE INDEX "HappyHour_timezone_idx" ON "HappyHour"("timezone");

-- CreateIndex
CREATE INDEX "HappyHour_status_idx" ON "HappyHour"("status");

-- CreateIndex
CREATE INDEX "HappyHourLog_happyHourId_idx" ON "HappyHourLog"("happyHourId");

-- CreateIndex
CREATE INDEX "HappyHourLog_branchId_idx" ON "HappyHourLog"("branchId");

-- CreateIndex
CREATE INDEX "HappyHourLog_createdAt_idx" ON "HappyHourLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserBranchPreference_userId_branchId_key" ON "UserBranchPreference"("userId", "branchId");

-- CreateIndex
CREATE INDEX "BusinessPolicy_category_idx" ON "BusinessPolicy"("category");

-- CreateIndex
CREATE INDEX "BusinessPolicy_branchId_idx" ON "BusinessPolicy"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPolicy_key_branchId_key" ON "BusinessPolicy"("key", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_key_key" ON "IdempotencyKey"("key");

-- CreateIndex
CREATE INDEX "IdempotencyKey_key_idx" ON "IdempotencyKey"("key");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricDevice_deviceId_key" ON "BiometricDevice"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricDevice_token_key" ON "BiometricDevice"("token");

-- CreateIndex
CREATE INDEX "BiometricDevice_userId_idx" ON "BiometricDevice"("userId");

-- CreateIndex
CREATE INDEX "BiometricDevice_deviceId_idx" ON "BiometricDevice"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSettings_key_key" ON "SystemSettings"("key");

-- CreateIndex
CREATE INDEX "CouponRequest_status_idx" ON "CouponRequest"("status");

-- CreateIndex
CREATE INDEX "DailyReport_date_idx" ON "DailyReport"("date");

-- CreateIndex
CREATE INDEX "DailyReport_branchId_idx" ON "DailyReport"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_date_branchId_key" ON "DailyReport"("date", "branchId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotificationPreference" ADD CONSTRAINT "UserNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranch" ADD CONSTRAINT "UserBranch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranch" ADD CONSTRAINT "UserBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchPermissions" ADD CONSTRAINT "BranchPermissions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchItem" ADD CONSTRAINT "BranchItem_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchItem" ADD CONSTRAINT "BranchItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchVariant" ADD CONSTRAINT "BranchVariant_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchVariant" ADD CONSTRAINT "BranchVariant_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ItemVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVariant" ADD CONSTRAINT "ItemVariant_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemModifier" ADD CONSTRAINT "ItemModifier_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_replacedFromId_fkey" FOREIGN KEY ("replacedFromId") REFERENCES "OrderItem"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNotificationPreference" ADD CONSTRAINT "CustomerNotificationPreference_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCancellation" ADD CONSTRAINT "OrderCancellation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAuditLog" ADD CONSTRAINT "OrderAuditLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAuditLog" ADD CONSTRAINT "CustomerAuditLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemAuditLog" ADD CONSTRAINT "SystemAuditLog_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialLedger" ADD CONSTRAINT "FinancialLedger_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialApproval" ADD CONSTRAINT "FinancialApproval_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "FinancialLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialApproval" ADD CONSTRAINT "FinancialApproval_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReward" ADD CONSTRAINT "CustomerReward_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReward" ADD CONSTRAINT "CustomerReward_rewardItemId_fkey" FOREIGN KEY ("rewardItemId") REFERENCES "RewardItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchMetric" ADD CONSTRAINT "BranchMetric_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardedLoyaltyPoints" ADD CONSTRAINT "AwardedLoyaltyPoints_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyFinancialSnapshot" ADD CONSTRAINT "DailyFinancialSnapshot_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HappyHour" ADD CONSTRAINT "HappyHour_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HappyHourLog" ADD CONSTRAINT "HappyHourLog_happyHourId_fkey" FOREIGN KEY ("happyHourId") REFERENCES "HappyHour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessPolicy" ADD CONSTRAINT "BusinessPolicy_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRequest" ADD CONSTRAINT "CouponRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRequest" ADD CONSTRAINT "CouponRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

