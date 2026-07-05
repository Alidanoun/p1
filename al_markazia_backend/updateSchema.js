const fs = require('fs');
const file = 'c:/Users/User/Desktop/p4/al_markazia_backend/prisma/schema.prisma';
let content = fs.readFileSync(file, 'utf8');

// Update User model
content = content.replace(
  '  @@index([email], map: "idx_users_email")\n}',
  '  @@index([email], map: "idx_users_email")\n\n  // CRM Module Relations\n  assignedLeads             Lead[]                @relation("LeadAssignment")\n  assignedOpportunities     Opportunity[]         @relation("OpportunityAssignment")\n  performedSalesActivities  SalesActivity[]       @relation("SalesActivityPerformedBy")\n  opportunityAuditChanges   OpportunityAuditLog[] @relation("OpportunityAuditChangedBy")\n}'
);

// Update Branch model
content = content.replace(
  '  permissions        BranchPermissions?\n  dailyReports       DailyReport[]\n}',
  '  permissions        BranchPermissions?\n  dailyReports       DailyReport[]\n\n  // CRM Module Relations\n  leads               Lead[]\n  opportunities       Opportunity[]\n  salesActivities     SalesActivity[]\n}'
);

// Update Customer model
content = content.replace(
  '  referredByMe Customer[] @relation("ReferralRelation")\n\n  @@index([isBlacklisted])\n}',
  '  referredByMe Customer[] @relation("ReferralRelation")\n\n  // CRM Module Relations\n  leadsConverted      Lead?           @relation("LeadToCustomer")\n  opportunities       Opportunity[]\n  salesActivities     SalesActivity[]\n\n  @@index([isBlacklisted])\n}'
);

// Append new models
const crmModels = `
// ============================================================================
// CRM MODULE
// ============================================================================

/// 🛡️ [ARCHITECTURAL-DECISION]: Lead uses phoneHash and emailHash for unique secure searching,
/// identical to Customer. It strictly enforces branch isolation.
model Lead {
  id                   Int       @id @default(autoincrement())
  uuid                 String    @unique @default(uuid())
  name                 String
  phone                String?
  phoneHash            String?   @unique
  email                String?
  emailHash            String?   @unique
  source               String?   // e.g., "Facebook", "Walk-in", "Website"
  status               String    @default("NEW") // NEW, CONTACTED, QUALIFIED, LOST
  
  // Branch Isolation
  branchId             String
  branch               Branch    @relation(fields: [branchId], references: [id], onDelete: Restrict)
  
  // Assigned Sales Rep (Proper Int relation to User)
  assignedToId         Int?
  assignedTo           User?     @relation("LeadAssignment", fields: [assignedToId], references: [id], onDelete: SetNull)
  
  // Conversion Logic (Crucial to prevent duplicates)
  isConverted          Boolean   @default(false)
  convertedAt          DateTime?
  convertedCustomerId  Int?      @unique
  convertedCustomer    Customer? @relation("LeadToCustomer", fields: [convertedCustomerId], references: [id])
  
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  opportunities        Opportunity[]
  activities           SalesActivity[]

  @@index([branchId])
  @@index([status])
  @@index([assignedToId])
}

/// 🛡️ [ARCHITECTURAL-DECISION]: Opportunity represents the Sales Pipeline Kanban card.
model Opportunity {
  id                   Int       @id @default(autoincrement())
  uuid                 String    @unique @default(uuid())
  title                String
  value                Decimal   @default(0) @db.Decimal(10, 2)
  stage                String    @default("NEW") // NEW, QUALIFIED, PROPOSAL, NEGOTIATION, WON, LOST
  lossReason           String?
  
  // Link to either a Lead or an existing Customer
  leadId               Int?
  lead                 Lead?     @relation(fields: [leadId], references: [id])
  customerId           Int?
  customer             Customer? @relation(fields: [customerId], references: [id])
  
  // Branch Isolation
  branchId             String
  branch               Branch    @relation(fields: [branchId], references: [id], onDelete: Restrict)
  
  // Assigned Sales Rep (Proper Int relation to User)
  assignedToId         Int?
  assignedTo           User?     @relation("OpportunityAssignment", fields: [assignedToId], references: [id], onDelete: SetNull)
  
  // State Machine Tracking
  version              Int       @default(1)
  
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  expectedCloseDate    DateTime?

  auditLogs            OpportunityAuditLog[]
  activities           SalesActivity[]

  @@index([branchId])
  @@index([stage])
  @@index([assignedToId])
  @@index([leadId])
  @@index([customerId])
}

/// 🛡️ [ARCHITECTURAL-DECISION]: Enforces a strict State Machine for the Sales Pipeline.
/// Unlike OrderAuditLog which uses a loose string, this uses a typed relation for changedById.
model OpportunityAuditLog {
  id              Int         @id @default(autoincrement())
  opportunityId   Int
  eventType       String      // e.g., "STAGE_CHANGE", "ASSIGNMENT_CHANGE"
  eventAction     String      // e.g., "MOVED_TO_NEGOTIATION"
  
  // User making the change (Proper Int relation to User)
  changedById     Int?
  changedBy       User?       @relation("OpportunityAuditChangedBy", fields: [changedById], references: [id], onDelete: SetNull)
  changedByRole   String
  
  previousData    String?
  newData         String?
  changedFields   String?
  reason          String?     // Loss reason or change justification
  createdAt       DateTime    @default(now())
  
  opportunity     Opportunity @relation(fields: [opportunityId], references: [id], onDelete: Cascade)

  @@index([opportunityId])
  @@index([createdAt])
  @@index([eventType])
  @@index([changedById])
}

/// 🛡️ [ARCHITECTURAL-DECISION]: Separate from CustomerAuditLog. This is for human interactions.
model SalesActivity {
  id              Int       @id @default(autoincrement())
  uuid            String    @unique @default(uuid())
  type            String    // CALL, EMAIL, WHATSAPP, MEETING, NOTE
  subject         String?
  notes           String?
  
  // Can be linked to a Lead, Customer, or specific Opportunity
  leadId          Int?
  lead            Lead?     @relation(fields: [leadId], references: [id])
  customerId      Int?
  customer        Customer? @relation(fields: [customerId], references: [id])
  opportunityId   Int?
  opportunity     Opportunity? @relation(fields: [opportunityId], references: [id])
  
  // Branch Isolation
  branchId        String
  branch          Branch    @relation(fields: [branchId], references: [id], onDelete: Restrict)
  
  // Executed By (Proper Int relation to User)
  performedById   Int
  performedBy     User      @relation("SalesActivityPerformedBy", fields: [performedById], references: [id], onDelete: Restrict)
  
  activityDate    DateTime  @default(now())
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([branchId])
  @@index([performedById])
  @@index([leadId])
  @@index([customerId])
  @@index([opportunityId])
}
`;

content += '\n' + crmModels;

fs.writeFileSync(file, content, 'utf8');
console.log('Schema updated successfully');
