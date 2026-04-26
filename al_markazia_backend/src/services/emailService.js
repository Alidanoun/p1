const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    // 🔍 Connection Diagnostic
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      logger.info(`📧 Email Service Initialized for: ${process.env.EMAIL_USER}`);
    } else {
      logger.warn('⚠️ Email Service: Missing credentials in .env');
    }
  }

  /**
   * 📧 Send OTP Verification Code
   */
  async sendOtp(email, code) {
    const mailOptions = {
      from: `"مطعم المركزية" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'كود التحقق الخاص بك - مطعم المركزية',
      html: `
        <div style="direction: rtl; font-family: Tahoma, sans-serif; text-align: center; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #FF6D00;">أهلاً بك في مطعم المركزية</h2>
          <p>شكراً لاهتمامك بالانضمام إلينا. كود التحقق الخاص بك هو:</p>
          <div style="background: #f4f4f4; padding: 15px; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #333; margin: 20px 0;">
            ${code}
          </div>
          <p style="font-size: 12px; color: #888;">هذا الكود صالح لمدة 10 دقائق فقط. يرجى عدم مشاركته مع أحد.</p>
        </div>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info('OTP Email sent successfully', { email });
      return true;
    } catch (error) {
      logger.error('❌ Failed to send OTP Email', { email, error: error.message });
      console.log(`\n\n[DEV ONLY] OTP for ${email}: ${code}\n\n`);
      return false;
    }
  }

  /**
   * 🔐 Send Password Reset OTP
   */
  async sendPasswordResetOtp(email, code) {
    const mailOptions = {
      from: `"مطعم المركزية" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: '🔐 طلب إعادة تعيين كلمة المرور - مطعم المركزية',
      html: `
        <div style="direction: rtl; font-family: Tahoma, sans-serif; text-align: center; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #FF6D00;">🔐 إعادة تعيين كلمة المرور</h2>
          <p>لقد تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بك. كود التحقق هو:</p>
          <div style="background: #f4f4f4; padding: 15px; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #333; margin: 20px 0;">
            ${code}
          </div>
          <div style="background:#FFF8E1; border-right:4px solid #FFC107; padding: 15px; margin: 10px 0; text-align: right; display: inline-block;">
            ⏱️ صالح لمدة 5 دقائق فقط<br/>
            🔒 لا تشارك هذا الكود مع أحد<br/>
            ❗ إذا لم تطلب إعادة التعيين، يرجى تجاهل هذا البريد
          </div>
        </div>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info('Password Reset Email sent successfully', { email });
      return true;
    } catch (error) {
      logger.error('❌ Failed to send Password Reset Email', { email, error: error.message });
      console.log(`\n\n[DEV ONLY] Reset OTP for ${email}: ${code}\n\n`);
      return false;
    }
  }
}

module.exports = new EmailService();
