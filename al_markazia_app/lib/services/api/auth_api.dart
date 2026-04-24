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
      body: json.encode({
        'email': email,
        'password': password,
      }),
    ).timeout(const Duration(seconds: 10));

    if (response.statusCode == 200) {
      return _normalizeAuthResponse(json.decode(utf8.decode(response.bodyBytes)));
    } else {
      final errorData = json.decode(utf8.decode(response.bodyBytes));
      throw Exception(errorData['error'] ?? 'بيانات الدخول غير صحيحة');
    }
  }

  /// 🔐 Register with Enterprise JWT Support
  Future<Map<String, dynamic>> registerCustomer(String name, String email, String password) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/register'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'name': name,
        'email': email,
        'password': password,
      }),
    ).timeout(const Duration(seconds: 10));

    if (response.statusCode == 200) {
      return json.decode(utf8.decode(response.bodyBytes));
    } else {
      final errorData = json.decode(utf8.decode(response.bodyBytes));
      throw Exception(errorData['error'] ?? 'فشل إنشاء الحساب');
    }
  }

  /// ✅ Phase 2: Verify Registration OTP
  Future<Map<String, dynamic>> verifyRegistration(String email, String code) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/verify-registration'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'email': email,
        'code': code,
      }),
    ).timeout(const Duration(seconds: 10));

    if (response.statusCode == 200) {
      return _normalizeAuthResponse(json.decode(utf8.decode(response.bodyBytes)));
    } else {
      final errorData = json.decode(utf8.decode(response.bodyBytes));
      throw Exception(errorData['error'] ?? 'كود التحقق غير صحيح');
    }
  }

  /// 🛡️ Enterprise Response Mapping
  /// Maps the backend {accessToken, refreshToken, user: {id (UUID), name...}}
  Map<String, dynamic> _normalizeAuthResponse(Map<String, dynamic> jsonResponse) {
    if (jsonResponse['accessToken'] == null) {
      // Compatibility fallback if backend sends nested 'data'
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
