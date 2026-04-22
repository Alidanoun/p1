import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_dotenv/flutter_dotenv.dart';

class AuthApi {
  static String get baseUrl {
    final ip = dotenv.get('SERVER_IP', fallback: 'localhost');
    final port = dotenv.get('SERVER_PORT', fallback: '5000');
    return 'http://$ip:$port';
  }

  /// 🔐 Login with Enterprise JWT Support
  Future<Map<String, dynamic>> loginCustomer(String phone) async {
    final response = await http.post(
      Uri.parse('$baseUrl/customers/login'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({'phone': phone}),
    ).timeout(const Duration(seconds: 10));

    if (response.statusCode == 200) {
      return _normalizeAuthResponse(json.decode(utf8.decode(response.bodyBytes)));
    } else {
      final errorData = json.decode(utf8.decode(response.bodyBytes));
      throw Exception(errorData['error'] ?? 'بيانات الدخول غير صحيحة');
    }
  }

  /// 🔐 Register with Enterprise JWT Support
  Future<Map<String, dynamic>> registerCustomer(String name, String phone) async {
    final response = await http.post(
      Uri.parse('$baseUrl/customers/register'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({'name': name, 'phone': phone}),
    ).timeout(const Duration(seconds: 10));

    if (response.statusCode == 200) {
      return _normalizeAuthResponse(json.decode(utf8.decode(response.bodyBytes)));
    } else {
      final errorData = json.decode(utf8.decode(response.bodyBytes));
      throw Exception(errorData['error'] ?? 'فشل إنشاء الحساب');
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
