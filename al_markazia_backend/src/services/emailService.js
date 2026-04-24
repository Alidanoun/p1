const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// إنشاء الـ transporter مرة واحدة (Singleton)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// التحقق من الاتصال عند بدء السيرفر
// ملاحظة: قد يفشل في بيئة التطوير إذا لم يتم ضبط المتغيرات بشكل صحيح،
// لكننا نسجل النتيجة للتشخيص.
transporter.verify((error) => {
  if (error) {
    logger.error('Gmail SMTP connection failed', { error: error.message });
  } else {
    logger.info('Gmail SMTP ready to send emails');
  }
});

/**
 * إرسال OTP للبريد الإلكتروني
 * @param {string} email - البريد المستهدف
 * @param {string} code - الرمز السري (6 أرقام)
 * @param {string} purpose - 'login' أو 'register'
 */
async function sendOtpEmail(email, code, purpose = 'login') {
  const subject = purpose === 'login'
    ? 'رمز تسجيل الدخول — المركزية'
    : 'رمز تأكيد التسجيل — المركزية';

  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME || 'Al Markazia'}" <${process.env.GMAIL_USER}>`,
    to: email,
    subject,
    html: `
      <div style="
        font-family: Arial, sans-serif;
        direction: rtl;
        text-align: right;
        max-width: 480px;
        margin: auto;
        padding: 32px;
        border: 1px solid #eee;
        border-radius: 16px;
        background-color: #ffffff;
      ">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #FF5252; margin: 0; font-size: 28px;">المركزية 🍽️</h1>
        </div>
        <p style="color: #555; font-size: 16px; margin-bottom: 8px;">مرحباً،</p>
        <p style="color: #555; font-size: 16px; margin-bottom: 24px;">رمز التحقق الخاص بك هو:</p>
        <div style="
          background: #fdf2f2;
          border-radius: 12px;
          padding: 24px;
          text-align: center;
          font-size: 38px;
          font-weight: bold;
          letter-spacing: 12px;
          color: #222;
          margin: 24px 0;
          border: 1px dashed #FF5252;
        ">${code}</div>
        <p style="color: #888; font-size: 13px; line-height: 1.6;">
          هذا الرمز صالح لمدة <strong>5 دقائق</strong> فقط لدواعٍ أمنية.<br/>
          إذا لم تطلب هذا الرمز، يرجى تجاهل هذه الرسالة أو التواصل مع الدعم الفني.
        </p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #aaa; font-size: 11px; text-align: center;">
          هذا البريد مرسل تلقائياً، يرجى عدم الرد عليه.
        </p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info('OTP email sent', { to: email, messageId: info.messageId, purpose });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error('Failed to send OTP email', { email, error: error.message });
    
    // In dev, we might not have real credentials, so don't crash the whole flow
    if (process.env.NODE_ENV === 'development') {
        logger.warn('Email sending failed in development, showing code in logs');
        return { success: true, simulated: true };
    }
    
    throw new Error('EMAIL_SEND_FAILED');
  }
}

module.exports = { sendOtpEmail };
