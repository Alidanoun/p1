const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/server');
const TokenService = require('../src/services/tokenService');
const { v4: uuidv4 } = require('uuid');
const customFieldService = require('../src/services/customFieldService');
const leadService = require('../src/services/leadService');
const opportunityService = require('../src/services/opportunityService');
const redis = require('../src/lib/redis');
const { runAsSystemAdmin, runAsBranch } = require('../src/utils/context');

const prisma = new PrismaClient();

describe('⚙️ Custom Fields System - Service & Integration Test', () => {
  let testBranch, testAdmin, testAdminToken, adminJti;
  let testStaff, testStaffToken, staffJti;

  beforeAll(async () => {
    // Wrap database creation in runAsSystemAdmin to bypass RLS
    await runAsSystemAdmin(async () => {
      // 1. Create a test branch
      testBranch = await prisma.branch.create({
        data: {
          name: 'Test CRM Custom Fields Branch',
          code: `BR-CRM-${Date.now()}`
        }
      });

      // 2. Create Test Admin
      testAdmin = await prisma.user.create({
        data: {
          email: `admin_crm_${Date.now()}@test.com`,
          password: 'Password123!',
          role: 'ADMIN',
          isActive: true,
          branchId: testBranch.id
        }
      });

      adminJti = uuidv4();
      await prisma.refreshToken.create({
        data: {
          token: `ref_admin_${adminJti}`,
          userId: testAdmin.uuid,
          role: 'admin',
          jti: adminJti,
          expiresAt: new Date(Date.now() + 3600000)
        }
      });

      testAdminToken = TokenService.generateAccessToken({
        id: testAdmin.id,
        uuid: testAdmin.uuid,
        role: 'admin',
        authVersion: 1,
        permissionVersion: 1
      }, adminJti);

      // 3. Create Test Staff (without CRM permissions to test 403)
      testStaff = await prisma.user.create({
        data: {
          email: `staff_crm_${Date.now()}@test.com`,
          password: 'Password123!',
          role: 'STAFF',
          isActive: true,
          branchId: testBranch.id
        }
      });

      staffJti = uuidv4();
      await prisma.refreshToken.create({
        data: {
          token: `ref_staff_${staffJti}`,
          userId: testStaff.uuid,
          role: 'staff',
          jti: staffJti,
          expiresAt: new Date(Date.now() + 3600000)
        }
      });

      testStaffToken = TokenService.generateAccessToken({
        id: testStaff.id,
        uuid: testStaff.uuid,
        role: 'staff',
        authVersion: 1,
        permissionVersion: 1
      }, staffJti);
    });
  });

  afterAll(async () => {
    // Cleanup in system context
    await runAsSystemAdmin(async () => {
      await prisma.customFieldDefinition.deleteMany({
        where: { branchId: testBranch.id }
      });
      await prisma.opportunityAuditLog.deleteMany({
        where: { opportunity: { branchId: testBranch.id } }
      });
      await prisma.opportunity.deleteMany({
        where: { branchId: testBranch.id }
      });
      await prisma.lead.deleteMany({
        where: { branchId: testBranch.id }
      });
      await prisma.refreshToken.deleteMany({
        where: { userId: { in: [testAdmin.uuid, testStaff.uuid] } }
      });
      await prisma.user.deleteMany({
        where: { branchId: testBranch.id }
      });
      await prisma.branch.delete({
        where: { id: testBranch.id }
      });
    });
    await prisma.$disconnect();
    await redis.quitAll();
  });

  describe('🧩 Definition Management (CRUD)', () => {
    let definitionId;

    it('should allow Super Admin to create a custom field definition', async () => {
      const res = await request(app)
        .post('/api/v1/crm/custom-fields/definitions')
        .set('Authorization', `Bearer ${testAdminToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          entityType: 'LEAD',
          key: 'expected_revenue',
          label: 'الإيراد المتوقع',
          fieldType: 'NUMBER',
          isRequired: true,
          branchId: testBranch.id
        });

      if (res.status !== 201) console.error('createDefinition fail body:', res.body);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.key).toBe('expected_revenue');
      definitionId = res.body.data.id;
    });

    it('should reject duplicate keys for the same branch and entity', async () => {
      const res = await request(app)
        .post('/api/v1/crm/custom-fields/definitions')
        .set('Authorization', `Bearer ${testAdminToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          entityType: 'LEAD',
          key: 'expected_revenue',
          label: 'الإيراد المتوقع 2',
          fieldType: 'NUMBER',
          isRequired: false,
          branchId: testBranch.id
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it('should prevent non-admin staff from creating definitions', async () => {
      const res = await request(app)
        .post('/api/v1/crm/custom-fields/definitions')
        .set('Authorization', `Bearer ${testStaffToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          entityType: 'LEAD',
          key: 'staff_key',
          label: 'حقل الموظف',
          fieldType: 'TEXT',
          isRequired: false,
          branchId: testBranch.id
        });

      expect(res.status).toBe(403);
    });

    it('should retrieve definitions list for branch staff', async () => {
      // Use testAdminToken since admin is the authorized staff member for CRM
      const res = await request(app)
        .get(`/api/v1/crm/custom-fields/definitions/LEAD?branchId=${testBranch.id}`)
        .set('Authorization', `Bearer ${testAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const keys = res.body.data.map(d => d.key);
      expect(keys).toContain('expected_revenue');
    });

    it('should allow Admin to update a definition', async () => {
      const res = await request(app)
        .patch(`/api/v1/crm/custom-fields/definitions/${definitionId}`)
        .set('Authorization', `Bearer ${testAdminToken}`)
        .set('Idempotency-Key', uuidv4())
        .send({
          label: 'الإيراد التقريبي',
          isRequired: false
        });

      if (res.status !== 200) console.error('updateDefinition fail body:', res.body);
      expect(res.status).toBe(200);
      expect(res.body.data.label).toBe('الإيراد التقريبي');
      expect(res.body.data.isRequired).toBe(false);
    });

    it('should allow Admin to soft-delete (deactivate) a definition', async () => {
      const res = await request(app)
        .delete(`/api/v1/crm/custom-fields/definitions/${definitionId}`)
        .set('Authorization', `Bearer ${testAdminToken}`);

      if (res.status !== 200) console.error('deleteDefinition fail body:', res.body);
      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);

      // Verify it is no longer retrieved for forms
      const listRes = await request(app)
        .get(`/api/v1/crm/custom-fields/definitions/LEAD?branchId=${testBranch.id}`)
        .set('Authorization', `Bearer ${testAdminToken}`);
      
      const keys = listRes.body.data.map(d => d.key);
      expect(keys).not.toContain('expected_revenue');
    });
  });

  describe('🧪 Runtime Zod Validation & Dynamic Schema Enforcement', () => {
    beforeAll(async () => {
      await runAsSystemAdmin(async () => {
        // Re-enable definition or create new ones for test
        await customFieldService.createDefinition({
          entityType: 'LEAD',
          key: 'age',
          label: 'العمر',
          fieldType: 'NUMBER',
          isRequired: true,
          branchId: testBranch.id
        });

        await customFieldService.createDefinition({
          entityType: 'LEAD',
          key: 'hobbies',
          label: 'الهوايات',
          fieldType: 'TEXT',
          isRequired: false,
          branchId: testBranch.id
        });
      });
    });

    it('should reject creating a lead with missing required custom fields', async () => {
      const res = await request(app)
        .post('/api/v1/crm/leads')
        .set('Authorization', `Bearer ${testAdminToken}`)
        .set('x-branch-context', testBranch.id)
        .set('Idempotency-Key', uuidv4())
        .send({
          name: 'Lead Missing Custom Field',
          phone: '0790000001',
          branchId: testBranch.id,
          customFields: {
            hobbies: 'Football'
            // Missing 'age' which is required
          }
        });

      if (res.status !== 400) console.error('missing fields fail body:', res.body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject custom fields containing invalid datatypes', async () => {
      const res = await request(app)
        .post('/api/v1/crm/leads')
        .set('Authorization', `Bearer ${testAdminToken}`)
        .set('x-branch-context', testBranch.id)
        .set('Idempotency-Key', uuidv4())
        .send({
          name: 'Lead Invalid Type',
          phone: '0790000002',
          branchId: testBranch.id,
          customFields: {
            age: 'not_a_number', // should be number
            hobbies: 'Reading'
          }
        });

      expect(res.status).toBe(400);
    });

    it('should accept custom fields that match the definitions schema', async () => {
      const res = await request(app)
        .post('/api/v1/crm/leads')
        .set('Authorization', `Bearer ${testAdminToken}`)
        .set('x-branch-context', testBranch.id)
        .set('Idempotency-Key', uuidv4())
        .send({
          name: 'Valid Custom Lead',
          phone: '0790000003',
          branchId: testBranch.id,
          customFields: {
            age: 25,
            hobbies: 'Gaming'
          }
        });

      if (res.status !== 201) console.error('valid custom lead fail body:', res.body);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.customFields.age).toBe(25);
    });
  });

  describe('🔄 Lead-to-Opportunity Custom Fields Copying (Intersection)', () => {
    beforeAll(async () => {
      await runAsSystemAdmin(async () => {
        // Define same key 'budget' on both LEAD and OPPORTUNITY
        await customFieldService.createDefinition({
          entityType: 'LEAD',
          key: 'budget',
          label: 'ميزانية العميل',
          fieldType: 'NUMBER',
          branchId: testBranch.id
        });
        await customFieldService.createDefinition({
          entityType: 'OPPORTUNITY',
          key: 'budget',
          label: 'ميزانية العقد',
          fieldType: 'NUMBER',
          branchId: testBranch.id
        });

        // Define 'lead_source_detail' ONLY on LEAD
        await customFieldService.createDefinition({
          entityType: 'LEAD',
          key: 'lead_source_detail',
          label: 'تفاصيل المصدر',
          fieldType: 'TEXT',
          branchId: testBranch.id
        });
      });
    });

    it('should copy only intersection fields from Lead to Opportunity during conversion', async () => {
      // 1. Create a lead with both fields wrapped in RLS branch context
      const lead = await runAsBranch(testBranch.id, async () => {
        return leadService.createLead({
          name: 'Convertible Lead',
          phone: '0799999999',
          branchId: testBranch.id,
          customFields: {
            budget: 5000,
            lead_source_detail: 'Ad Campaign X'
          }
        }, testAdmin);
      });

      // 2. Convert and check Opportunity creation copying wrapped in RLS branch context
      const opp = await runAsBranch(testBranch.id, async () => {
        return opportunityService.createOpportunity({
          title: 'New Opp from Lead',
          leadId: lead.id,
          branchId: testBranch.id,
          value: 5000
        }, testAdmin);
      });

      // 'budget' should be copied because it is defined on both
      expect(opp.customFields.budget).toBe(5000);
      // 'lead_source_detail' should NOT be copied because it is not defined on OPPORTUNITY
      expect(opp.customFields.lead_source_detail).toBeUndefined();
    });
  });
});
