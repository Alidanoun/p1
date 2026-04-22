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
    // Determine the absolute path. This assumes relativePath starts with '/' and root is one directory up from src
    const filename = path.basename(relativePath);
    const directory = path.dirname(relativePath).replace(/^\//, ''); // Removes leading slash
    const fullPath = path.join(__dirname, '..', '..', directory, filename);
    
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
