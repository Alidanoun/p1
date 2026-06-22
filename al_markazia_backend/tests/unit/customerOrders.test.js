const { authenticateCustomer } = require('../../src/middleware/auth');
const { verifyOrderOwnership } = require('../../src/middleware/ownership');
const TokenService = require('../../src/services/tokenService');
const prisma = require('../../src/lib/prisma');

jest.mock('../../src/services/tokenService');
jest.mock('../../src/lib/prisma', () => ({
  order: {
    findUnique: jest.fn()
  }
}));

jest.mock('../../src/utils/logger', () => ({
  debug: jest.fn(),
  security: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

describe('authenticateCustomer Middleware Group', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {
      headers: {},
      cookies: {},
      ip: '127.0.0.1',
      user: null
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  test('authenticateCustomer[1] should allow customer role', () => {
    req.user = { id: 'cust-123', role: 'customer' };
    authenticateCustomer[1](req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('authenticateCustomer[1] should allow admin role', () => {
    req.user = { id: 'admin-123', role: 'admin' };
    authenticateCustomer[1](req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('authenticateCustomer[1] should deny branch manager or other staff roles with 403', () => {
    req.user = { id: 'staff-123', role: 'branch_manager' };
    authenticateCustomer[1](req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: 'FORBIDDEN_ACCESS'
      })
    }));
    expect(next).not.toHaveBeenCalled();
  });
});

describe('verifyOrderOwnership Middleware', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {
      params: { id: '10' },
      user: { id: 'cust-123', role: 'customer', branchId: null },
      ip: '127.0.0.1'
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  test('should allow customer to access their own order', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 10,
      customerId: 'cust-123',
      branchId: 1
    });

    await verifyOrderOwnership(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('should deny customer from accessing another customer\'s order', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 10,
      customerId: 'other-cust-456',
      branchId: 1
    });

    await verifyOrderOwnership(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: 'FORBIDDEN_ACCESS'
      })
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('should allow admin to access any order', async () => {
    req.user = { id: 'admin-123', role: 'admin', branchId: null };
    prisma.order.findUnique.mockResolvedValue({
      id: 10,
      customerId: 'other-cust-456',
      branchId: 1
    });

    await verifyOrderOwnership(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
