import 'package:flutter/material.dart';
import '../../theme/design_system.dart';

/**
 * 📢 UI Feedback Utility
 * Purpose: Provide consistent, beautiful, and user-friendly error/success messaging.
 */
class UIFeedback {
  static void showSuccess(BuildContext context, String message) {
    _showSnackBar(context, message, DesignSystem.success, Icons.check_circle_outline);
  }

  static void showError(BuildContext context, String message) {
    _showSnackBar(context, message, DesignSystem.error, Icons.error_outline);
  }

  static void showWarning(BuildContext context, String message) {
    _showSnackBar(context, message, DesignSystem.warning, Icons.warning_amber_rounded);
  }

  static void _showSnackBar(BuildContext context, String message, Color color, IconData icon) {
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(icon, color: Colors.white, size: 24),
            const SizedBox(width: DesignSystem.spacingM),
            Expanded(
              child: Text(
                message,
                style: const TextStyle(
                  fontFamily: 'Cairo',
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
            ),
          ],
        ),
        backgroundColor: color,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(DesignSystem.radiusM)),
        margin: const EdgeInsets.all(DesignSystem.spacingM),
        duration: const Duration(seconds: 4),
      ),
    );
  }

  /// 🛰️ Dynamic Error Translator
  /// Translates technical Backend errors into friendly Arabic messages for the customer.
  static String translateError(String technicalError) {
    if (technicalError.contains('INSUFFICIENT_POINTS')) return 'عذراً، رصيدك من النقاط غير كافٍ لإتمام هذه العملية.';
    if (technicalError.contains('RESTAURANT_CLOSED')) return 'نعتذر منك، المطعم مغلق حالياً ولا يستقبل طلبات.';
    if (technicalError.contains('INVALID_SESSION')) return 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.';
    if (technicalError.contains('CONNECTION_TIMEOUT')) return 'عذراً، يبدو أن هناك مشكلة في الاتصال بالسيرفر. يرجى التأكد من الإنترنت.';
    
    return 'حدث خطأ غير متوقع، يرجى المحاولة لاحقاً.';
  }
}
