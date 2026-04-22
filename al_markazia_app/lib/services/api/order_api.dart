import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_dotenv/flutter_dotenv.dart';
import '../../models/order_model.dart';
import '../api_service.dart';

class OrderApi {
  static String get baseUrl {
    final ip = dotenv.get('SERVER_IP', fallback: 'localhost');
    final port = dotenv.get('SERVER_PORT', fallback: '5000');
    return 'http://$ip:$port';
  }

  /// 🛡️ Secure Identity Layer Check
  void _checkAuth(http.Response response) {
    if (response.statusCode == 401) {
      throw Exception('401'); // Trigger atomic-refresh in ApiService
    }
  }

  /// 🔐 Place Order using Authenticated Identity
  Future<OrderModel?> placeOrder(OrderModel order, Map<String, String> headers) async {
    final response = await http.post(
      Uri.parse('$baseUrl/orders'),
      headers: headers,
      body: json.encode(order.toJson()),
    ).timeout(const Duration(seconds: 10));

    _checkAuth(response);

    if (response.statusCode == 201) {
      final Map<String, dynamic> data = json.decode(utf8.decode(response.bodyBytes));
      // Map cart items for local model consistency
      data['cartItems'] = order.cartItems.map((e) => e.toJson()).toList();
      return OrderModel.fromJson(data);
    } else {
      final Map<String, dynamic> errorData = json.decode(utf8.decode(response.bodyBytes));
      
      // 🚀 Superior Error Parsing: Extract clean message from Enterprise structure
      String errorMsg = 'Failed to place order';
      if (errorData['error'] != null) {
        if (errorData['error'] is Map) {
          errorMsg = errorData['error']['message'] ?? errorMsg;
          if (errorData['error']['code'] == 'PRICE_CHANGED') {
             throw Exception('PRICE_CHANGED:$errorMsg');
          }
        } else {
          errorMsg = errorData['error'].toString();
        }
      }

      throw Exception(errorMsg);
    }
  }

  /// 🔐 Fetch Orders using Authenticated Identity (UUID-based)
  /// Replaces the old /customer/:phone endpoint
  Future<List<OrderModel>> fetchMyOrders(Map<String, String> headers, {int page = 1, int limit = 10}) async {
    final response = await http.get(
      Uri.parse('$baseUrl/orders/my-orders?page=$page&limit=$limit'),
      headers: headers,
    ).timeout(const Duration(seconds: 10));

    _checkAuth(response);
    
    if (response.statusCode == 200) {
      final decoded = json.decode(utf8.decode(response.bodyBytes));
      if (decoded is Map && decoded.containsKey('data')) {
        final List data = decoded['data'];
        return data.map((json) => OrderModel.fromJson(json)).toList();
      }
    } else {
       final Map<String, dynamic> errorData = json.decode(utf8.decode(response.bodyBytes));
       String errorMsg = 'Failed to fetch orders';
       if (errorData['error'] != null && errorData['error'] is Map) {
         errorMsg = errorData['error']['message'] ?? errorMsg;
       }
       print('❌ API Fetch Orders failure: $errorMsg');
    }
    return [];
  }

  /// 🔐 Cancel Order using Authenticated Identity
  Future<void> cancelOrder({
    required String orderId,
    required String reason,
    required Map<String, String> headers,
    String? managerPassword,
    bool isAdmin = false,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/orders/$orderId/cancel'),
      headers: headers,
      body: json.encode({
        'reason': reason,
        'managerPassword': managerPassword,
        'isAdmin': isAdmin,
        // customerPhone is NO LONGER required as it's extracted from JWT
      }),
    ).timeout(const Duration(seconds: 10));

    _checkAuth(response);

    if (response.statusCode != 200) {
      final Map<String, dynamic> errorData = json.decode(utf8.decode(response.bodyBytes));
      String errorMsg = 'Failed to cancel order';
       if (errorData['error'] != null && errorData['error'] is Map) {
         errorMsg = errorData['error']['message'] ?? errorMsg;
       }
      throw Exception(errorMsg);
    }
  }

  Future<void> rateOrder(String orderId, int rating, String comment) async {
    // Public endpoint for now, or can be protected if needed
    final response = await http.patch(
      Uri.parse('$baseUrl/orders/$orderId/rate'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'rating': rating,
        'ratingComment': comment,
      }),
    ).timeout(const Duration(seconds: 10));

    if (response.statusCode != 200) {
      final Map<String, dynamic> errorData = json.decode(utf8.decode(response.bodyBytes));
      String errorMsg = 'Failed to submit review';
       if (errorData['error'] != null && errorData['error'] is Map) {
         errorMsg = errorData['error']['message'] ?? errorMsg;
       }
      throw Exception(errorMsg);
    }
  }
}
