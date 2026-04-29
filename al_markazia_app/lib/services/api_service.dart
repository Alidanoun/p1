import 'package:flutter/foundation.dart' hide Category;
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/menu_item.dart';
import '../models/order_model.dart';
import 'api/auth_api.dart';
import 'api/order_api.dart';
import 'session_service.dart';
import '../models/restaurant_status.dart';
import '../features/checkout/models/delivery_zone.dart';

class ApiService {
  final _authApi = AuthApi();
  final _orderApi = OrderApi();

  /// 🏥 Fetch Restaurant Operational Status
  Future<RestaurantStatus> fetchRestaurantStatus() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/restaurant/status'))
          .timeout(const Duration(seconds: 5));
      
      if (response.statusCode == 200) {
        final decoded = json.decode(utf8.decode(response.bodyBytes));
        return RestaurantStatus.fromJson(decoded['data']);
      }
      return RestaurantStatus(isOpen: true, isEmergency: false);
    } catch (e) {
      return RestaurantStatus(isOpen: true, isEmergency: false); // Fail-safe
    }
  }

  Future<bool> subscribeToReopening(String fcmToken, String nextOpenAt) async {
    try {
      final heads = await _headers;
      final response = await http.post(
        Uri.parse('$baseUrl/restaurant/subscribe'),
        headers: heads,
        body: json.encode({
          'fcmToken': fcmToken,
          'nextOpenAt': nextOpenAt,
        }),
      ).timeout(const Duration(seconds: 10));

      return response.statusCode == 200;
    } catch (e) {
      debugPrint('Subscribe Error: $e');
      return false;
    }
  }
  
  static String get baseUrl {
    const ip = String.fromEnvironment('SERVER_IP', defaultValue: '192.168.3.138');
    const port = String.fromEnvironment('SERVER_PORT', defaultValue: '5000');
    final scheme = const bool.fromEnvironment('dart.vm.product') ? 'https' : 'http';
    return '$scheme://$ip:$port';
  }

  /// 🛡️ Enterprise Security: Centralized Header Injection
  Future<Map<String, String>> get _headers async {
    final token = await SessionService.instance.accessToken;
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  // --- CACHE LAYER (Performance Hardening) ---
  List<Category>? _categoryCache;
  DateTime? _categoryCacheTime;
  List<MenuItem>? _menuItemCache;
  DateTime? _menuItemCacheTime;
  List<DeliveryZone>? _deliveryZoneCache;
  DateTime? _deliveryZoneCacheTime;
  // ✅ Reduced TTL to 1 minute so admin panel changes reflect quickly
  static const _cacheTTL = Duration(minutes: 1);
  static const _longCacheTTL = Duration(minutes: 5);

  /// Clears all cached data to force a fresh fetch from the server.
  void clearCache() {
    _categoryCache = null;
    _categoryCacheTime = null;
    _menuItemCache = null;
    _menuItemCacheTime = null;
    _deliveryZoneCache = null;
    _deliveryZoneCacheTime = null;
    debugPrint('🗑️ [Cache] Cleared all cached data.');
  }

  // --- RESILIENCE & OBSERVABILITY ---

  Future<bool>? _refreshFuture;

  Future<OrderModel?> fetchActiveOrder() async {
    try {
      final heads = await _headers;
      final orders = await _orderApi.fetchMyOrders(heads, page: 1, limit: 1);
      if (orders.isNotEmpty) {
        final order = orders.first;
        if (order.status != 'delivered' && order.status != 'cancelled') {
          return order;
        }
      }
      return null;
    } catch (e) {
      debugPrint('Fetch Active Order Error: $e');
      return null;
    }
  }

  Future<T> _withRetry<T>(Future<T> Function() action, {int maxAttempts = 3, int refreshAttempts = 0}) async {
    int attempts = 0;
    while (true) {
      attempts++;
      try {
        final stopwatch = Stopwatch()..start();
        final result = await action();
        stopwatch.stop();
        debugPrint('⏱️ [API Timing] Request completed in ${stopwatch.elapsedMilliseconds}ms');
        return result;
      } catch (e) {
        final errorStr = e.toString();
        
        // --- 🔐 JWT SECURITY LAYER: SINGLETON AUTO REFRESH ---
        if (errorStr.contains('401') || errorStr.contains('SESSION_EXPIRED') || errorStr.contains('TOKEN_EXPIRED')) {
          
          // 🛡️ Loop Guard: Only 1 refresh attempt per logical request chain
          if (refreshAttempts >= 1) {
            debugPrint('🚨 [Auth] Refresh loop detected. Triggering Logout.');
            _handle401();
            rethrow;
          }

          debugPrint('🔐 [Auth] Token Invalidation Detected. Synchronizing Refresh...');
          
          // 🥇 Singleton Refresh: Concurrent requests will WAIT for this future
          _refreshFuture ??= _attemptTokenRefresh();
          
          final refreshed = await _refreshFuture;
          
          // Reset future after completion so next batch can refresh if needed
          _refreshFuture = null;

          if (refreshed == true) {
            debugPrint('✅ [Auth] Session Restored. Retrying original request (Attempt chain 2)...');
            // Retry the action with incremented refreshAttempts to prevent loops
            return _withRetry(action, maxAttempts: maxAttempts, refreshAttempts: refreshAttempts + 1);
          } else {
            debugPrint('❌ [Auth] Refresh failed. Triggering Logout.');
            _handle401();
            rethrow;
          }
        }

        // --- NETWORK RETRY LAYER ---
        if (attempts >= maxAttempts) {
          debugPrint('❌ [API Error] Max retries ($maxAttempts) reached: $errorStr');
          rethrow;
        }

        // Exponential Backoff for Network blips
        final delay = Duration(seconds: attempts * 2);
        debugPrint('⚠️ [API Retry] Attempt $attempts failed. Retrying in ${delay.inSeconds}s... ($errorStr)');
        await Future.delayed(delay);
      }
    }
  }

  /// 🔄 Atomic Background Token Refresh Strategy
  Future<bool> _attemptTokenRefresh() async {
    try {
      final refresh = await SessionService.instance.refreshToken;
      if (refresh == null) return false;

      final response = await http.post(
        Uri.parse('$baseUrl/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({'refreshToken': refresh}),
      ).timeout(const Duration(seconds: 12));

      if (response.statusCode == 200) {
        final decoded = json.decode(utf8.decode(response.bodyBytes));
        final data = (decoded is Map && decoded.containsKey('data')) ? decoded['data'] : decoded;
        
        String? newRefresh = data['refreshToken'];
        if (newRefresh == null) {
          final setCookieStr = response.headers['set-cookie'];
          if (setCookieStr != null) {
            final match = RegExp(r'refreshToken=([^;]+)').firstMatch(setCookieStr);
            if (match != null) newRefresh = match.group(1);
          }
        }
        
        await SessionService.instance.saveSession(
          accessToken: data['accessToken'],
          refreshToken: newRefresh ?? refresh,
        );
        return true;
      }
      return false;
    } catch (e) {
      debugPrint('❌ [Critical] Atomic Refresh Failure: $e');
      return false;
    }
  }

  Future<List<Category>> fetchCategories({bool forceRefresh = false}) async {
    return _withRetry(() async {
      // 🥇 Check Cache First (skip if forceRefresh)
      if (!forceRefresh && _categoryCache != null && _categoryCacheTime != null) {
        if (DateTime.now().difference(_categoryCacheTime!) < _cacheTTL) {
          debugPrint('🚀 [Cache Hit] Categories served from cache.');
          return _categoryCache!;
        }
      }
      // ✅ Wipe stale cache to guarantee fresh data on forceRefresh
      _categoryCache = null;
      _categoryCacheTime = null;

      final heads = await _headers;
      final response = await http.get(Uri.parse('$baseUrl/categories'), headers: heads).timeout(const Duration(seconds: 10));
      
      if (response.statusCode == 401) throw Exception('401');
      
      if (response.statusCode == 200) {
        final decoded = json.decode(utf8.decode(response.bodyBytes));
        final List data = (decoded is Map && decoded.containsKey('data')) ? decoded['data'] : (decoded is List ? decoded : []);
        
        final categories = data.map((json) {
          if (json['image'] != null && json['image'].toString().startsWith('/')) {
            json['image'] = '$baseUrl${json['image']}';
          }
          return Category.fromJson(json);
        }).toList();

        _categoryCache = categories;
        _categoryCacheTime = DateTime.now();
        return categories;
      } else {
        throw Exception('Failed to load categories');
      }
    });
  }

  Future<List<MenuItem>> fetchMenuItems({bool forceRefresh = false}) async {
    return _withRetry(() async {
      // 🥇 Check Cache First (skip if forceRefresh)
      if (!forceRefresh && _menuItemCache != null && _menuItemCacheTime != null) {
        if (DateTime.now().difference(_menuItemCacheTime!) < _cacheTTL) {
          debugPrint('🚀 [Cache Hit] Menu items served from cache.');
          return _menuItemCache!;
        }
      }
      // ✅ Wipe stale cache to guarantee fresh data on forceRefresh
      _menuItemCache = null;
      _menuItemCacheTime = null;

      final heads = await _headers;
      final response = await http.get(Uri.parse('$baseUrl/items'), headers: heads).timeout(const Duration(seconds: 10));
      
      if (response.statusCode == 401) throw Exception('401');

      if (response.statusCode == 200) {
        final decoded = json.decode(utf8.decode(response.bodyBytes));
        final List data = (decoded is Map && decoded.containsKey('data')) ? decoded['data'] : (decoded is List ? decoded : []);
        
        final items = data.map((json) {
          if (json['image'] != null && json['image'].toString().startsWith('/')) {
            json['image'] = '$baseUrl${json['image']}';
          }
          return MenuItem.fromJson(json);
        }).toList();

        _menuItemCache = items;
        _menuItemCacheTime = DateTime.now();
        return items;
      } else {
        throw Exception('Failed to load menu items');
      }
    });
  }

  // --- Dependencies ---
  Future<List<DeliveryZone>> fetchDeliveryZones({bool forceRefresh = false}) async {
    return _withRetry(() async {
      // 🥇 Check Cache First (skip if forceRefresh)
      if (!forceRefresh && _deliveryZoneCache != null && _deliveryZoneCacheTime != null) {
        if (DateTime.now().difference(_deliveryZoneCacheTime!) < _longCacheTTL) {
          debugPrint('🚀 [Cache Hit] Delivery zones served from cache.');
          return _deliveryZoneCache!;
        }
      }
      // ✅ Wipe stale cache
      _deliveryZoneCache = null;
      _deliveryZoneCacheTime = null;

      final heads = await _headers;
      final response = await http.get(Uri.parse('$baseUrl/delivery-zones/active'), headers: heads).timeout(const Duration(seconds: 10));
      
      if (response.statusCode == 200) {
        final Map<String, dynamic> body = json.decode(utf8.decode(response.bodyBytes));
        if (body['success'] == true) {
          final List data = body['data'] ?? [];
          final zones = data.map((z) => DeliveryZone.fromJson(z)).toList();
          
          _deliveryZoneCache = zones;
          _deliveryZoneCacheTime = DateTime.now();
          return zones;
        }
        throw Exception('API returned failure for delivery zones');
      } else {
        throw Exception('Failed to load delivery zones (${response.statusCode})');
      }
    });
  }

  static Function()? onAuthError;

  void _handle401() {
    debugPrint('Token expired or invalid: 401');
    if (onAuthError != null) onAuthError!();
  }

  // --- Orders Delegation (Strangler Pattern) ---
  Future<OrderModel?> placeOrder(OrderModel order) async {
    final heads = await _headers;
    return _withRetry(() => _orderApi.placeOrder(order, heads));
  }

  Future<List<OrderModel>> fetchCustomerOrders(String phone, {int page = 1, int limit = 10}) async {
    final heads = await _headers;
    // Note: phone parameter is kept for signature compatibility but ignored for authenticated my-orders
    return _withRetry(() => _orderApi.fetchMyOrders(heads, page: page, limit: limit));
  }
  
  Future<void> rateOrder(String orderId, int rating, String comment) {
    return _withRetry(() async {
      final heads = await _headers;
      return _orderApi.rateOrder(orderId, rating, comment, heads);
    });
  }

  Future<void> cancelOrder({
    required String orderId,
    required String reason,
    String? customerPhone,
    String? managerPassword,
    bool isAdmin = false,
  }) async {
    final heads = await _headers;
    return _withRetry(() => _orderApi.cancelOrder(
      orderId: orderId,
      reason: reason,
      headers: heads,
      managerPassword: managerPassword,
      isAdmin: isAdmin
    ));
  }

  // --- Auth Delegation (Strangler Pattern) ---
  Future<Map<String, dynamic>> loginCustomer(String email, String password) async {
    final response = await _authApi.loginCustomer(email, password);
    await SessionService.instance.saveUser(response);
    return response;
  }

  Future<Map<String, dynamic>> registerCustomer({
    required String name,
    required String email,
    required String password,
    required String phone,
  }) async {
    final response = await _authApi.registerCustomer(
      name: name,
      email: email,
      password: password,
      phone: phone,
    );
    await SessionService.instance.saveUser(response);
    return response;
  }

  Future<Map<String, dynamic>> fetchCustomerProfile(String email, String password) async {
    return loginCustomer(email, password);
  }

  // --- Reviews Delegation ---
  // If there are other review actions, they should eventually move to ReviewApi
  Future<List<Review>> fetchItemReviews(int itemId) async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/reviews/item/$itemId')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        final decoded = json.decode(utf8.decode(response.bodyBytes));
        final List data = (decoded is Map && decoded.containsKey('data')) ? decoded['data'] : (decoded is List ? decoded : []);
        return data.map((json) => Review.fromJson(json)).toList();
      }
      return [];
    } catch (e) {
      debugPrint('Fetch Reviews Error: $e');
      return [];
    }
  }

  Future<void> submitReview(int itemId, String customerName, int rating, String comment) {
    return _withRetry(() async {
      final heads = await _headers;
      final response = await http.post(
        Uri.parse('$baseUrl/reviews'),
        headers: heads,
        body: json.encode({
          'itemId': itemId,
          'customerName': customerName,
          'rating': rating,
          'comment': comment,
        }),
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 401) throw Exception('401');

      if (response.statusCode != 201) {
        final errorData = json.decode(utf8.decode(response.bodyBytes));
        throw Exception(errorData['error'] ?? 'Failed to submit review');
      }
    });
  }

  /// 🔍 Professional Search API
  Future<List<MenuItem>> searchItems(String query) async {
    final response = await http.get(
      Uri.parse('$baseUrl/items/search?q=${Uri.encodeComponent(query)}'),
      headers: {'Accept': 'application/json'},
    ).timeout(const Duration(seconds: 8));

    if (response.statusCode == 200) {
      final decoded = json.decode(utf8.decode(response.bodyBytes));
      final List data = (decoded is Map && decoded.containsKey('data')) ? decoded['data'] : (decoded is List ? decoded : []);
      
      return data.map((json) {
        if (json['image'] != null && json['image'].toString().startsWith('/')) {
          json['image'] = '$baseUrl${json['image']}';
        }
        return MenuItem.fromJson(json);
      }).toList();
    } else {
      throw Exception('Search failed');
    }
  }

  // ════════════════════════════════════════════════════════
  //  🆕 Token Refresh (used by biometric login)
  // ════════════════════════════════════════════════════════
  static ApiService? _instance;
  static ApiService get instance {
    _instance ??= ApiService();
    return _instance!;
  }

  Future<String?> refreshTokens() async {
    try {
      final refreshToken = await SessionService.instance.refreshToken;
      if (refreshToken == null) return null;

      final response = await http.post(
        Uri.parse('$baseUrl/auth/refresh'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $refreshToken',
        },
        body: json.encode({'refreshToken': refreshToken}),
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final body = json.decode(utf8.decode(response.bodyBytes));
        final data = body['data'] ?? body;
        final newAccessToken = data['accessToken'] as String?;
        final newRefreshToken = data['refreshToken'] as String?;

        if (newAccessToken != null) {
          await SessionService.instance.saveSession(
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
          );
          return newAccessToken;
        }
      }
      return null;
    } catch (e) {
      debugPrint('ApiService.refreshTokens failed: $e');
      return null;
    }
  }

  // Ends of API Service
}
