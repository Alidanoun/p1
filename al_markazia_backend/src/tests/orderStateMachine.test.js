describe('Order State Machine', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('should allow valid transitions', () => {
    const { validateTransition } = require('../validators/orderStateMachine');
    expect(validateTransition('pending', 'preparing', '123')).toBe(true);
    expect(validateTransition('preparing', 'ready', '123')).toBe(true);
    expect(validateTransition('ready', 'delivered', '123')).toBe(true);
  });

  test('should allow cancellation from multiple states', () => {
    const { validateTransition } = require('../validators/orderStateMachine');
    expect(validateTransition('pending', 'cancelled', '123')).toBe(true);
    expect(validateTransition('preparing', 'cancelled', '123')).toBe(true);
    expect(validateTransition('ready', 'cancelled', '123')).toBe(true);
  });

  test('should allow self-transition (idempotency)', () => {
    const { validateTransition } = require('../validators/orderStateMachine');
    expect(validateTransition('pending', 'pending', '123')).toBe(true);
    expect(validateTransition('ready', 'ready', '123')).toBe(true);
  });

  test('should handle case-insensitive input', () => {
    const { validateTransition } = require('../validators/orderStateMachine');
    expect(validateTransition('PENDING', 'Preparing', '123')).toBe(true);
  });

  test('should log warning but return true in LOG_ONLY mode for invalid transition', () => {
    const originalMode = process.env.ORDER_STATE_MODE;
    process.env.ORDER_STATE_MODE = 'LOG_ONLY';
    
    const { validateTransition: valTransition } = require('../validators/orderStateMachine');
    expect(valTransition('delivered', 'pending', '123')).toBe(true);
    
    if (originalMode) {
      process.env.ORDER_STATE_MODE = originalMode;
    } else {
      delete process.env.ORDER_STATE_MODE;
    }
  });
});
