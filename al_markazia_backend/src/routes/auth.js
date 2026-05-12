const express = require('express');
const { login, register, verifyRegistration, forgotPassword, resetPassword, refreshToken, logout, getMe, getSessions } = require('../controllers/authController');
const { loginLimiter, otpLimiter, refreshTokenLimiter } = require('../middleware/advancedRateLimiter');
const { authenticateToken } = require('../middleware/auth');

const { loginValidation, registerValidation } = require('../validators/authValidator');
const validate = require('../middleware/validate');

const router = express.Router();

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: تسجيل الدخول (Login)
 *     description: Authenticates a user/admin/branch_manager via email and password. Returns JWT access token and sets httpOnly refresh cookie.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: admin@almarkazia.com
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 example: "123456"
 *               fcmToken:
 *                 type: string
 *                 description: Firebase Cloud Messaging token for push notifications
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         email:
 *                           type: string
 *                         name:
 *                           type: string
 *                         role:
 *                           type: string
 *                           enum: [admin, branch_manager, customer]
 *                         branchId:
 *                           type: string
 *                           nullable: true
 *                         branchName:
 *                           type: string
 *                           nullable: true
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Account locked or disabled
 *       429:
 *         description: Too many login attempts
 */
router.post('/login', loginLimiter, loginValidation, validate, login);

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: تسجيل حساب جديد (Register)
 *     description: Creates a new customer account. Sends OTP for verification.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP sent for verification
 *       400:
 *         description: Validation error
 */
router.post('/register', otpLimiter, registerValidation, validate, register);

/**
 * @swagger
 * /auth/verify-registration:
 *   post:
 *     summary: تحقق من رمز التسجيل (Verify OTP)
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Account verified successfully
 */
router.post('/verify-registration', otpLimiter, verifyRegistration);

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: نسيت كلمة المرور (Forgot Password)
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Reset OTP sent
 */
router.post('/forgot-password', otpLimiter, forgotPassword);

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: إعادة تعيين كلمة المرور (Reset Password)
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Password reset successful
 */
router.post('/reset-password', otpLimiter, resetPassword);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: تجديد الجلسة (Refresh Token)
 *     description: Rotates the refresh token and returns a new access token. Uses httpOnly cookie.
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: New access token issued
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post('/refresh', refreshTokenLimiter, refreshToken);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: تسجيل الخروج (Logout)
 *     description: Revokes the current session and clears the refresh cookie.
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post('/logout', authenticateToken, logout);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: بيانات المستخدم الحالي (Current User)
 *     description: Returns the authenticated user's profile data from the database.
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile data
 *       401:
 *         description: Not authenticated
 */
router.get('/me', authenticateToken, getMe);

/**
 * @swagger
 * /auth/sessions:
 *   get:
 *     summary: الجلسات النشطة (Active Sessions)
 *     description: Lists all active sessions for the current user.
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of active sessions
 */
router.get('/sessions', authenticateToken, getSessions);

module.exports = router;

