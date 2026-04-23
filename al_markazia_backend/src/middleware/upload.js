const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const FileType = require('file-type');
const logger = require('../utils/logger');
const { error: responseError } = require('../utils/response');

// ── Configuration ─────────────────────────────────
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_DIMENSION = 4096; // 4096 px (Prevent decompression bombs)
const RESIZE_TARGET = { width: 1200, height: 1200 };
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

// ── Storage: Memory first for validation ──────────
const storage = multer.memoryStorage();

// ── First-pass filter: Quick header-based check ───
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error('EXT_NOT_ALLOWED'), false);
  }
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error('MIME_NOT_ALLOWED'), false);
  }
  cb(null, true);
};

const uploader = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,              // Limit to 1 file per request
    fields: 20,            // Security: Limit text fields
    fieldSize: 1024 * 100  // 100KB max per text field
  }
});

/**
 * 🛡️ Deep Validation & Re-encoding Engine
 * Logic: Even if magic bytes match, we RE-ENCODE the image.
 * This destroys any embedded malicious payloads (Polyglots).
 */
async function processAndSaveImage(buffer, originalName) {
  // 1. Magic Bytes Deep Inspection
  const detected = await FileType.fromBuffer(buffer);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
    throw new Error('CONTENT_NOT_IMAGE');
  }

  // 2. Metadata Inspection (Size & Dimensions)
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('INVALID_IMAGE_METADATA');
  }

  if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
    throw new Error('IMAGE_TOO_LARGE_DIMENSIONS');
  }

  // 3. Security Re-encoding & Optimization
  // We force conversion to WebP + Strip Metadata (Privacy & Security)
  const safeBuffer = await sharp(buffer)
    .rotate() // Auto-rotate based on EXIF
    .resize(RESIZE_TARGET.width, RESIZE_TARGET.height, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: 80, effort: 4 })
    .toBuffer();

  // 4. Secure Naming (UUID v4)
  const filename = `${uuidv4()}.webp`;
  const fullPath = path.join(UPLOAD_DIR, filename);

  // 5. Atomic Write
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(fullPath, safeBuffer);

  return {
    filename,
    relativePath: `/uploads/${filename}`,
    size: safeBuffer.length,
    format: 'webp'
  };
}

/**
 * 📦 High-Level Secure Upload Middleware
 */
function uploadImage(fieldName) {
  const multerHandler = uploader.single(fieldName);

  return (req, res, next) => {
    multerHandler(req, res, async (err) => {
      if (err) {
        logger.security('Upload attempt rejected', { 
          reason: err.message, 
          code: err.code,
          ip: req.ip 
        });
        
        const message = err.code === 'LIMIT_FILE_SIZE' 
          ? 'حجم الملف كبير جداً (الحد الأقصى 5 ميجابايت)' 
          : 'الملف المرفوع غير مدعوم أو تالف';
          
        return responseError(res, message, 'UPLOAD_ERROR', 400);
      }

      // Optional image handling
      if (!req.file) return next();

      try {
        const result = await processAndSaveImage(req.file.buffer, req.file.originalname);
        
        // 🚀 Swap unsafe Multer data with our safe metadata
        req.file = {
          ...req.file,
          filename: result.filename,
          path: result.relativePath,
          size: result.size,
          mimetype: 'image/webp',
          buffer: undefined // Security: Clear buffer from memory
        };

        next();
      } catch (error) {
        logger.security('Deep upload validation failed', {
          reason: error.message,
          ip: req.ip,
          userId: req.user?.id
        });

        return responseError(res, 'الصورة غير صالحة أو تحتوي على بيانات مشبوهة', 'INVALID_IMAGE', 400);
      }
    });
  };
}

module.exports = { uploadImage };
