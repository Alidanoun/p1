import 'package:flutter/foundation.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../api_service.dart';

class AuthApi {
  static String get baseUrl => ApiService.baseUrl;

  /// 🔐 Login with Enterprise JWT Support
  Future<Map<String, dynamic>> loginCustomer(String email, String password) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({'email': email, 'password': password}),
    ).timeout(const Duration(seconds: 10));

    final dynamic decoded = json.decode(utf8.decode(response.bodyBytes));
    final Map<String, dynamic> data = decoded is Map<String, dynamic> ? decoded : {};

    if (response.statusCode == 200) {
      return _normalizeAuthResponse(data);
    } else {
      final error = data['error'];
      String message = 'بيانات الدخول غير صحيحة';
      
      if (error is Map) {
        message = error['message']?.toString() ?? message;
      } else if (error is String) {
        message = error;
      }
      
      throw Exception(message);
    }
  }

  /// 📝 Register (Phase 1: Send OTP)
  Future<Map<String, dynamic>> registerCustomer({
    required String name,
    required String email,
    required String password,
    required String phone,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/register'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'name': name,
        'email': email,
        'password': password,
        'phone': phone,
      }),
    ).timeout(const Duration(seconds: 10));

    Map<String, dynamic> data = {};
    try {
      final String body = utf8.decode(response.bodyBytes);
      if (body.isNotEmpty) {
        final decoded = json.decode(body);
        if (decoded is Map<String, dynamic>) {
          data = decoded;
        }
      }
    } catch (e) {
      debugPrint('Error decoding register response: $e');
    }

    if (response.statusCode == 200 || response.statusCode == 201) {
      return data;
    } else {
      final error = data['error'];
      String message = 'فشل إنشاء الحساب';
      
      if (error is Map) {
        message = error['message']?.toString() ?? message;
      } else if (error is String) {
        message = error;
      }
      
      throw Exception(message);
    }
  }

  /// ✅ Verify Registration OTP (Phase 2)
  Future<Map<String, dynamic>> verifyRegistration(String email, String code) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/verify-registration'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({'email': email, 'code': code}),
    ).timeout(const Duration(seconds: 10));

    final dynamic decoded = json.decode(utf8.decode(response.bodyBytes));
    final Map<String, dynamic> data = decoded is Map<String, dynamic> ? decoded : {};

    if (response.statusCode == 200) {
      return _normalizeAuthResponse(data);
    } else {
      final error = data['error'];
      String message = 'كود التحقق غير صحيح';
      
      if (error is Map) {
        message = error['message']?.toString() ?? message;
      } else if (error is String) {
        message = error;
      }
      
      throw Exception(message);
    }
  }

  // ════════════════════════════════════════════════════════
  //  🆕 FORGOT PASSWORD — Phase 1: Request OTP
  // ════════════════════════════════════════════════════════
  /// Sends a password-reset OTP to the given email.
  /// Always succeeds from the caller's perspective (anti-enumeration).
  Future<void> forgotPassword(String email) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/forgot-password'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({'email': email.toLowerCase().trim()}),
    ).timeout(const Duration(seconds: 10));

    final body = json.decode(utf8.decode(response.bodyBytes));

    if (response.statusCode == 429) {
      // Rate limit or cooldown — surface this to the user
      final msg = body['error']?['message'] ?? 'حاول بعد قليل';
      throw Exception(msg);
    }
    // 200 or any other status — we always treat as success (anti-enumeration)
    // The backend already returns 200 even for unknown emails.
  }

  // ════════════════════════════════════════════════════════
  //  🆕 FORGOT PASSWORD — Phase 2: Verify OTP + Set New Password
  // ════════════════════════════════════════════════════════
  /// Verifies the OTP and sets the new password.
  /// On success returns auth tokens (auto-login).
  Future<Map<String, dynamic>> resetPassword({
    required String email,
    required String code,
    required String newPassword,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/reset-password'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'email': email.toLowerCase().trim(),
        'code': code,
        'newPassword': newPassword,
      }),
    ).timeout(const Duration(seconds: 10));

    final body = json.decode(utf8.decode(response.bodyBytes));

    if (response.statusCode == 200) {
      return _normalizeAuthResponse(body);
    } else {
      final msg = body['error']?['message'] ?? body['error'] ?? 'فشل تعيين كلمة المرور';
      throw Exception(msg);
    }
  }

  /// 🔍 Fetch Current User Profile (Identity Refresh)
  Future<Map<String, dynamic>> getMe(String token) async {
    final response = await http.get(
      Uri.parse('$baseUrl/auth/me'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
    ).timeout(const Duration(seconds: 10));

    if (response.statusCode == 200) {
      final body = json.decode(utf8.decode(response.bodyBytes));
      return body['data'] ?? body['user'] ?? body;
    } else {
      throw Exception('فشل تحديث بيانات الحساب');
    }
  }

  /// 🛡️ Enterprise Response Mapping
  Map<String, dynamic> _normalizeAuthResponse(Map<String, dynamic>? jsonResponse) {
    if (jsonResponse == null) return {};
    
    // 🛡️ Standardize data container
    final Map<String, dynamic> data = (jsonResponse['data'] is Map) ? jsonResponse['data'] : jsonResponse;
    
    // 🛡️ Extract tokens with safety
    final String? accessToken = data['accessToken']?.toString() ?? jsonResponse['accessToken']?.toString();
    final String? refreshToken = data['refreshToken']?.toString() ?? jsonResponse['refreshToken']?.toString();
    
    // 🛡️ Extract user object
    final Map<String, dynamic> user = (data['user'] is Map) ? data['user'] : data;

    return {
      'accessToken': accessToken,
      'refreshToken': refreshToken,
      'user': user,
    };
  }
}
