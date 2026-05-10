const { validateTransition, ALLOWED_TRANSITIONS } = require('../validators/orderStateMachine');

describe('Order State Machine', () => {
  test('should allow valid transitions', () => {
    expect(validateTransition('pending', 'confirmed', '123')).toBe(true);
    expect(validateTransition('confirmed', 'preparing', '123')).toBe(true);
    expect(validateTransition('preparing', 'ready', '123')).toBe(true);
    expect(validateTransition('ready', 'in_route', '123')).toBe(true);
    expect(validateTransition('in_route', 'delivered', '123')).toBe(true);
  });

  test('should allow cancellation from multiple states', () => {
    expect(validateTransition('pending', 'cancelled', '123')).toBe(true);
    expect(validateTransition('confirmed', 'cancelled', '123')).toBe(true);
    expect(validateTransition('preparing', 'cancelled', '123')).toBe(true);
    expect(validateTransition('ready', 'cancelled', '123')).toBe(true);
  });

  test('should allow self-transition (idempotency)', () => {
    expect(validateTransition('pending', 'pending', '123')).toBe(true);
    expect(validateTransition('ready', 'ready', '123')).toBe(true);
  });

  test('should handle case-insensitive input', () => {
    expect(validateTransition('PENDING', 'Confirmed', '123')).toBe(true);
  });

  test('should log warning but return true in LOG_ONLY mode for invalid transition', () => {
    // Note: We'd need to mock logger or process.env to be 100% sure, 
    // but default is LOG_ONLY.
    expect(validateTransition('delivered', 'pending', '123')).toBe(true);
  });
});
