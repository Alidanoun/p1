const gateway = require('../services/contractGateway');
const logger = require('../utils/logger');

/**
 * 🛂 Order Modification Controller (Thin Layer)
 * RESPONSIBILITY: Entry Point -> Gateway Hand-off.
 */

exports.preview = async (req, res) => {
  try {
    const { id } = req.params;
    const { modifications } = req.body;

    const result = await gateway.execute(
      parseInt(id), 
      'PREVIEW', 
      { modifications }, 
      req.user
    );
    
    res.json(result);
  } catch (error) {
    logger.error('Gateway Preview Rejected', { error: error.message });
    res.status(400).json({ error: 'GATEWAY_REJECTED', message: error.message });
  }
};

exports.request = async (req, res) => {
  try {
    const { id } = req.params;
    const { modifications, idempotencyKey, orderVersion } = req.body;

    const result = await gateway.execute(
      parseInt(id),
      'REQUEST',
      { modifications, idempotencyKey, orderVersion },
      req.user
    );
    
    res.status(201).json(result);
  } catch (error) {
    logger.error('Gateway Request Rejected', { error: error.message });
    res.status(400).json({ error: 'GATEWAY_REJECTED', message: error.message });
  }
};

exports.apply = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { idempotencyKey, orderId } = req.body; // Need orderId for the lock

    const result = await gateway.execute(
      orderId,
      'APPLY',
      { eventId, idempotencyKey },
      req.user
    );
    
    res.json(result);
  } catch (error) {
    logger.error('Gateway Apply Rejected', { error: error.message });
    res.status(400).json({ error: 'GATEWAY_REJECTED', message: error.message });
  }
};

