import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../models/menu_item.dart';
import '../../models/branch_model.dart';
import '../../features/checkout/models/delivery_zone.dart';
import '../api_service.dart';
import '../../core/errors/app_exception.dart';

/// 🍽️ Menu, Catalogue & Restaurant API
/// Handles categories, items, delivery zones, branches, and search.
class MenuApi {
  static String get baseUrl => ApiService.baseUrl;

  // ─── Categories ──────────────────────────────────────────────────────────

  Future<List<Category>> fetchCategories(Map<String, String> headers) async {
    final response = await http
        .get(Uri.parse('$baseUrl/categories'), headers: headers)
        .timeout(const Duration(seconds: 10));

    if (response.statusCode == 401) throw const AuthException();
    if (response.statusCode == 200) {
      final decoded = json.decode(utf8.decode(response.bodyBytes));
      final List data = _extractList(decoded);
      return data.map((json) {
        if (json['image'] != null && json['image'].toString().startsWith('/')) {
          json['image'] = '$baseUrl${json['image']}';
        }
        return Category.fromJson(json);
      }).toList();
    }
    throw appExceptionFromHttp(response.statusCode, _tryDecode(response.bodyBytes));
  }

  // ─── Menu Items ──────────────────────────────────────────────────────────

  Future<List<MenuItem>> fetchMenuItems(Map<String, String> headers) async {
    final response = await http
        .get(Uri.parse('$baseUrl/items'), headers: headers)
        .timeout(const Duration(seconds: 10));

    if (response.statusCode == 401) throw const AuthException();
    if (response.statusCode == 200) {
      final decoded = json.decode(utf8.decode(response.bodyBytes));
      final List data = _extractList(decoded);
      return data.map((json) {
        if (json['image'] != null && json['image'].toString().startsWith('/')) {
          json['image'] = '$baseUrl${json['image']}';
        }
        return MenuItem.fromJson(json);
      }).toList();
    }
    throw appExceptionFromHttp(response.statusCode, _tryDecode(response.bodyBytes));
  }

  // ─── Search ──────────────────────────────────────────────────────────────

  Future<List<MenuItem>> searchItems(String query) async {
    final response = await http
        .get(
          Uri.parse('$baseUrl/items/search?q=${Uri.encodeComponent(query)}'),
          headers: {'Accept': 'application/json'},
        )
        .timeout(const Duration(seconds: 8));

    if (response.statusCode == 200) {
      final decoded = json.decode(utf8.decode(response.bodyBytes));
      final List data = _extractList(decoded);
      return data.map((json) {
        if (json['image'] != null && json['image'].toString().startsWith('/')) {
          json['image'] = '$baseUrl${json['image']}';
        }
        return MenuItem.fromJson(json);
      }).toList();
    }
    throw appExceptionFromHttp(response.statusCode, _tryDecode(response.bodyBytes));
  }

  // ─── Delivery Zones ──────────────────────────────────────────────────────

  Future<List<DeliveryZone>> fetchDeliveryZones(
    Map<String, String> headers,
  ) async {
    final response = await http
        .get(Uri.parse('$baseUrl/delivery-zones/active'), headers: headers)
        .timeout(const Duration(seconds: 10));

    if (response.statusCode == 200) {
      final body = json.decode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
      if (body['success'] == true) {
        final List data = (body['data'] as List?) ?? [];
        return data.map((z) => DeliveryZone.fromJson(z)).toList();
      }
    }
    throw appExceptionFromHttp(response.statusCode, _tryDecode(response.bodyBytes));
  }

  // ─── Branches ────────────────────────────────────────────────────────────

  Future<List<BranchModel>> fetchBranches(Map<String, String> headers) async {
    final response = await http
        .get(Uri.parse('$baseUrl/branch'), headers: headers)
        .timeout(const Duration(seconds: 10));

    if (response.statusCode == 200) {
      final body = json.decode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
      if (body['success'] == true) {
        final List data = (body['data'] as List?) ?? [];
        return data.map((b) => BranchModel.fromJson(b)).toList();
      }
    }
    throw appExceptionFromHttp(response.statusCode, _tryDecode(response.bodyBytes));
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  List _extractList(dynamic decoded) {
    if (decoded is Map && decoded.containsKey('data')) {
      final d = decoded['data'];
      return d is List ? d : [];
    }
    return decoded is List ? decoded : [];
  }

  Map<String, dynamic>? _tryDecode(List<int> bytes) {
    try {
      final body = json.decode(utf8.decode(bytes));
      return body is Map<String, dynamic> ? body : null;
    } catch (_) {
      return null;
    }
  }
}
