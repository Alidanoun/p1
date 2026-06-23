const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/server');
const TokenService = require('../src/services/tokenService');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

describe('⭐ Reviews System - Integration Test', () => {
  let testCustomer, testItem, testOrder, testReviewId, testCategory, testBranch, testAdmin;
  let testCustomerToken, testAdminToken;

  beforeAll(async () => {
    // Clean up any stale refresh tokens from previous failed runs
    await prisma.refreshToken.deleteMany({
      where: {
        token: { in: ['test_customer_refresh_token', 'test_admin_refresh_token'] }
      }
    });

    // 0. Create Test Category to avoid foreign key errors
    testCategory = await prisma.category.create({
      data: {
        name: 'Test Reviews Category',
        isActive: true
      }
    });

    // 0.5. Create Test Branch to avoid branchId constraint errors
    testBranch = await prisma.branch.create({
      data: {
        name: 'Test Reviews Branch',
        code: `BR-${Date.now()}`
      }
    });

    // 1. Create Test Item linked to the created category
    testItem = await prisma.item.create({
      data: {
        title: 'Test Burger',
        basePrice: 10,
        categoryId: testCategory.id
      }
    });

    // 2. Create Test Customer
    testCustomer = await prisma.customer.create({
      data: {
        name: 'Test Reviewer',
        phone: `079${Math.floor(Math.random() * 10000000)}`,
        email: `test_reviewer_${Date.now()}@test.com`
      }
    });

    // Create Test Customer Session in Database
    const customerJti = uuidv4();
    await prisma.refreshToken.create({
      data: {
        token: 'test_customer_refresh_token',
        userId: testCustomer.uuid,
        role: 'customer',
        jti: customerJti,
        expiresAt: new Date(Date.now() + 3600000)
      }
    });
    
    // Generate valid RS256 token
    testCustomerToken = TokenService.generateAccessToken({
      uuid: testCustomer.uuid,
      role: 'customer',
      authVersion: 1,
      permissionVersion: 1
    }, customerJti);

    // Create Test Admin User
    testAdmin = await prisma.user.create({
      data: {
        email: `test_admin_${Date.now()}@test.com`,
        password: 'ComplexityPassword123!',
        role: 'ADMIN',
        isActive: true
      }
    });

    // Create Test Admin Session in Database
    const adminJti = uuidv4();
    await prisma.refreshToken.create({
      data: {
        token: 'test_admin_refresh_token',
        userId: testAdmin.uuid,
        role: 'admin',
        jti: adminJti,
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    testAdminToken = TokenService.generateAccessToken({
      uuid: testAdmin.uuid,
      role: 'admin',
      authVersion: 1,
      permissionVersion: 1
    }, adminJti);

    // 3. Create Delivered Order (Verified Purchase Requirement)
    testOrder = await prisma.order.create({
      data: {
        orderNumber: `TEST-${Date.now()}`,
        customerId: testCustomer.id,
        customerName: testCustomer.name,
        customerPhone: testCustomer.phone || '0790000000',
        branchId: testBranch.id,
        orderType: 'dine_in',
        status: 'delivered',
        total: 10,
        orderItems: {
          create: {
            itemId: testItem.id,
            itemName: testItem.title,
            quantity: 1,
            unitPrice: 10,
            lineTotal: 10
          }
        }
      }
    });
  });

  test('POST /api/v1/reviews - Should submit a review with verified purchase', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${testCustomerToken}`)
      .send({
        itemId: testItem.id,
        rating: 5,
        comment: 'Great quality!'
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.isApproved).toBe(false); // Bias fix verification
    testReviewId = response.body.data.id;
  });

  test('PATCH /api/v1/reviews/:id - Should update own review', async () => {
    const response = await request(app)
      .patch(`/api/v1/reviews/${testReviewId}`)
      .set('Authorization', `Bearer ${testCustomerToken}`)
      .send({
        rating: 4,
        comment: 'Actually, it was okay.'
      });

    expect(response.status).toBe(200);
    expect(response.body.data.rating).toBe(4);
    expect(response.body.data.isApproved).toBe(false); // Should reset approval
  });

  test('GET /api/v1/reviews/stats - Should fetch star distribution', async () => {
    const response = await request(app)
      .get('/api/v1/reviews/stats')
      .set('Authorization', `Bearer ${testAdminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveProperty('4');
  });

  afterAll(async () => {
    // Revoke Refresh Tokens
    await prisma.refreshToken.deleteMany({
      where: {
        OR: [
          ...(testCustomer ? [{ userId: testCustomer.uuid }] : []),
          ...(testAdmin ? [{ userId: testAdmin.uuid }] : [])
        ]
      }
    });

    if (testReviewId) {
      await prisma.review.deleteMany({ where: { id: testReviewId } });
    }
    if (testOrder) {
      await prisma.orderItem.deleteMany({ where: { orderId: testOrder.id } });
      await prisma.order.delete({ where: { id: testOrder.id } });
    }
    if (testCustomer) {
      await prisma.customer.delete({ where: { id: testCustomer.id } });
    }
    if (testAdmin) {
      await prisma.user.delete({ where: { id: testAdmin.id } });
    }
    if (testItem) {
      await prisma.item.delete({ where: { id: testItem.id } });
    }
    if (testCategory) {
      await prisma.category.delete({ where: { id: testCategory.id } });
    }
    if (testBranch) {
      await prisma.branch.delete({ where: { id: testBranch.id } });
    }
    await prisma.$disconnect();
  });
});
