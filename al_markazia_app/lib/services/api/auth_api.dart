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

    if (response.statusCode == 200) {
      return _normalizeAuthResponse(json.decode(utf8.decode(response.bodyBytes)));
    } else {
      final errorData = json.decode(utf8.decode(response.bodyBytes));
      throw Exception(errorData['error']?['message'] ?? errorData['error'] ?? 'بيانات الدخول غير صحيحة');
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

    if (response.statusCode == 200) {
      return json.decode(utf8.decode(response.bodyBytes));
    } else {
      final errorData = json.decode(utf8.decode(response.bodyBytes));
      throw Exception(errorData['error']?['message'] ?? errorData['error'] ?? 'فشل إنشاء الحساب');
    }
  }

  /// ✅ Verify Registration OTP (Phase 2)
  Future<Map<String, dynamic>> verifyRegistration(String email, String code) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/verify-registration'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({'email': email, 'code': code}),
    ).timeout(const Duration(seconds: 10));

    if (response.statusCode == 200) {
      return _normalizeAuthResponse(json.decode(utf8.decode(response.bodyBytes)));
    } else {
      final errorData = json.decode(utf8.decode(response.bodyBytes));
      throw Exception(errorData['error']?['message'] ?? errorData['error'] ?? 'كود التحقق غير صحيح');
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

  /// 🛡️ Enterprise Response Mapping
  Map<String, dynamic> _normalizeAuthResponse(Map<String, dynamic> jsonResponse) {
    if (jsonResponse['accessToken'] == null) {
      final Map<String, dynamic> data = jsonResponse['data'] ?? jsonResponse;
      return {
        'accessToken': data['accessToken'],
        'refreshToken': data['refreshToken'],
        'user': data['user'] ?? data,
      };
    }
    return jsonResponse;
  }
}
