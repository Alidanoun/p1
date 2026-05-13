const conflictDetection = require('../../src/middleware/conflictDetection');

describe('Scoped Optimistic Concurrency Control (OCC) Middleware Security Suite', () => {
  let req;
  let res;
  let next;
  let findUniqueMock;

  beforeEach(() => {
    findUniqueMock = jest.fn();

    req = {
      method: 'PUT',
      headers: {
        'x-entity-version': '2',
        'x-client-timestamp': '2026-05-13T12:00:00Z',
        'x-idempotency-key': 'test-uuid-key'
      },
      params: { id: '101' },
      body: {},
      app: {
        locals: {
          prisma: {
            Order: { findUnique: findUniqueMock }
          }
        }
      }
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    next = jest.fn();
  });

  test('Scenario 1: Triggers HTTP 409 Conflict block exactly when client offline version lags behind current server aggregate state', async () => {
    // Current server row state is version 3
    findUniqueMock.mockResolvedValueOnce({
      id: 101,
      version: 3,
      status: 'confirmed',
      total: 150.50,
      updatedAt: new Date()
    });

    const middleware = conflictDetection('Order');
    await middleware(req, res, next);

    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: 101 } });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'CONFLICT_STATE_DETECTED',
        code: 'OPTIMISTIC_CONCURRENCY_CONFLICT',
        serverState: expect.objectContaining({
          version: 3,
          status: 'confirmed',
          total: 150.50
        }),
        clientVersion: 2
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('Scenario 2: Executes complete middleware continuation passthrough upon exact version synchronization match', async () => {
    // Current server row state perfectly matches version 2
    findUniqueMock.mockResolvedValueOnce({
      id: 101,
      version: 2,
      status: 'pending'
    });

    const middleware = conflictDetection('Order');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.currentEntityVersion).toBe(2);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('Scenario 3: Ignores read-only operations (GET/OPTIONS) entirely without performing database introspection', async () => {
    req.method = 'GET';
    
    const middleware = conflictDetection('Order');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  test('Scenario 4: Gracefully falls open upon missing version metadata parameters or missing Prisma hooks', async () => {
    delete req.headers['x-entity-version'];

    const middleware = conflictDetection('Order');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});
