const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const app = require('../src/server');

const prisma = new PrismaClient();

const generateTestToken = (userUuid, role = 'customer') => {
  return jwt.sign(
    { id: userUuid, role },
    process.env.JWT_SECRET || 'test_secret_for_ci_only',
    { expiresIn: '1h' }
  );
};

describe('⭐ Reviews System - Integration Test', () => {
  let testCustomer, testItem, testOrder, testReviewId;

  beforeAll(async () => {
    // 1. Create Test Item
    testItem = await prisma.item.create({
      data: {
        title: 'Test Burger',
        basePrice: 10,
        categoryId: 1 // Assuming category 1 exists or use a real one
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

    // 3. Create Delivered Order (Verified Purchase Requirement)
    testOrder = await prisma.order.create({
      data: {
        orderNumber: `TEST-${Date.now()}`,
        customerId: testCustomer.id,
        status: 'delivered',
        totalAmount: 10,
        orderItems: {
          create: {
            itemId: testItem.id,
            quantity: 1,
            unitPrice: 10
          }
        }
      }
    });
  });

  test('POST /api/v1/reviews - Should submit a review with verified purchase', async () => {
    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${generateTestToken(testCustomer.uuid)}`)
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
      .set('Authorization', `Bearer ${generateTestToken(testCustomer.uuid)}`)
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
      .set('Authorization', `Bearer ${generateTestToken('admin-uuid', 'admin')}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveProperty('4');
  });

  afterAll(async () => {
    if (testReviewId) {
      await prisma.review.deleteMany({ where: { id: testReviewId } });
    }
    await prisma.orderItem.deleteMany({ where: { orderId: testOrder.id } });
    await prisma.order.delete({ where: { id: testOrder.id } });
    await prisma.customer.delete({ where: { id: testCustomer.id } });
    await prisma.item.delete({ where: { id: testItem.id } });
    await prisma.$disconnect();
  });
});
