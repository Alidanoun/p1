import 'package:flutter/foundation.dart';

/// 📝 Unified Application Logging Utility
/// Supports colored debugging outputs and external metrics sink integration.
class AppLogger {
  static void info(String message) {
    if (kDebugMode) {
      print('🔵 [INFO] $message');
    }
  }

  static void success(String message) {
    if (kDebugMode) {
      print('🟢 [SUCCESS] $message');
    }
  }

  static void warn(String message) {
    if (kDebugMode) {
      print('🟡 [WARN] $message');
    }
  }

  static void error(String message) {
    if (kDebugMode) {
      print('🔴 [ERROR] $message');
    }
  }

  static void critical(String message) {
    if (kDebugMode) {
      print('💥 [CRITICAL] $message');
    }
  }
}
