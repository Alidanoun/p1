const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');

/**
 * 🖼️ Image Processing Service (Phase 3 Automation)
 * Uses Sharp to optimize, resize, and convert images to WebP.
 */
class ImageService {
  constructor() {
    this.UPLOAD_DIR = path.join(__dirname, '../../uploads');
    this.SIZES = {
      thumb: 200,
      medium: 600,
      large: 1200
    };
  }

  /**
   * Processes a newly uploaded image:
   * 1. Converts to WebP
   * 2. Generates multiple sizes
   * 3. Optimizes for web performance
   */
  async processMenuImage(filename) {
    const inputPath = path.join(this.UPLOAD_DIR, filename);
    const ext = path.extname(filename);
    const baseName = path.basename(filename, ext);

    try {
      const results = {};

      for (const [key, width] of Object.entries(this.SIZES)) {
        const outputName = `${baseName}_${key}.webp`;
        const outputPath = path.join(this.UPLOAD_DIR, outputName);

        await sharp(inputPath)
          .resize(width, width, { fit: 'cover' })
          .webp({ quality: 80 })
          .toFile(outputPath);

        results[key] = `/uploads/${outputName}`;
      }

      // Cleanup original if it's not webp
      if (ext !== '.webp') {
        await fs.unlink(inputPath).catch(() => {});
      }

      logger.info('[ImageService] Image processed successfully', { baseName });
      return results;
    } catch (err) {
      logger.error('[ImageService] Processing failed', { filename, error: err.message });
      return null;
    }
  }
}

module.exports = new ImageService();
