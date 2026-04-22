-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('normal', 'pending_partial_cancel', 'cancelled', 'rejected');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
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

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemOptionGroup" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "groupName" TEXT NOT NULL,
    "groupNameEn" TEXT,
    "type" TEXT NOT NULL DEFAULT 'SINGLE',
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ItemOptionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemOption" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ItemOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerId" INTEGER,
    "orderType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "paymentMethod" TEXT NOT NULL DEFAULT 'cash',
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "address" TEXT,
    "notes" TEXT,
    "estimatedReadyAt" TIMESTAMP(3),
    "rating" INTEGER,
    "ratingComment" TEXT,
    "isRatingApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "branch" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
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

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "fcmToken" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "cancellationCount" INTEGER NOT NULL DEFAULT 0,
    "isBlacklisted" BOOLEAN NOT NULL DEFAULT false,
    "blacklistedAt" TIMESTAMP(3),
    "blacklistExpiresAt" TIMESTAMP(3),
    "blacklistUntil" TIMESTAMP(3),
    "blacklistReason" TEXT,
    "blacklistReasonCode" TEXT,
    "blacklistSource" TEXT,
    "blacklistedBy" TEXT,
    "blacklistSeverity" TEXT NOT NULL DEFAULT 'LOW',
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "riskScoreUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
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

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "freeCancelWindowMinutes" INTEGER NOT NULL DEFAULT 5,
    "spamCancelLimit" INTEGER NOT NULL DEFAULT 3,
    "spamTimeWindowMinutes" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
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
    "orderId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" TIMESTAMP(3),
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

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_customerPhone_idx" ON "Order"("customerPhone");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_orderNumber_idx" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_isBlacklisted_idx" ON "Customer"("isBlacklisted");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Notification_customerPhone_idx" ON "Notification"("customerPhone");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderCancellation_orderId_key" ON "OrderCancellation"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSettings_key_key" ON "SystemSettings"("key");

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
CREATE INDEX "CustomerAuditLog_customerId_idx" ON "CustomerAuditLog"("customerId");

-- CreateIndex
CREATE INDEX "CustomerAuditLog_createdAt_idx" ON "CustomerAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemOptionGroup" ADD CONSTRAINT "ItemOptionGroup_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemOption" ADD CONSTRAINT "ItemOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ItemOptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCancellation" ADD CONSTRAINT "OrderCancellation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAuditLog" ADD CONSTRAINT "OrderAuditLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAuditLog" ADD CONSTRAINT "CustomerAuditLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
