const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Safely deletes an uploaded file relative to the src directory.
 * @param {string} relativePath - The relative path returned by the upload middleware (e.g., '/uploads/items/123.jpg')
 */
const deleteFile = (relativePath) => {
  if (!relativePath) return;
  try {
    const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
    const filename = path.basename(relativePath);
    const fullPath = path.resolve(UPLOAD_DIR, filename);
    
    // 🛡️ Path Traversal Guard: Ensure the resolved path is inside UPLOAD_DIR
    if (!fullPath.startsWith(UPLOAD_DIR + path.sep)) {
      logger.security('Refused to delete file outside UPLOAD_DIR', { path: relativePath });
      return;
    }

    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      logger.info('Deleted file', { path: relativePath });
    }
  } catch (err) {
    logger.error('Failed to delete file', { path: relativePath, error: err.message });
  }
};

module.exports = {
  deleteFile
};
