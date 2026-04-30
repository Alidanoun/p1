import 'package:flutter/foundation.dart' hide Category;
import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/menu_item.dart';
import '../models/order_model.dart';
import 'api/auth_api.dart';
import 'api/order_api.dart';
import 'session_service.dart';
import 'storage_service.dart';
import 'app_events.dart';
import '../models/restaurant_status.dart';
import '../features/checkout/models/delivery_zone.dart';

/// 🏥 Enterprise API Service (Intelligent Interceptor & Resilience Layer)
class ApiService {
  final _authApi = AuthApi();
  final _orderApi = OrderApi();
  
  // 🕒 Silent Refresh Management
  Timer? _silentRefreshTimer;

  static String get baseUrl {
    const ip = String.fromEnvironment('SERVER_IP', defaultValue: '192.168.3.154');
    const port = String.fromEnvironment('SERVER_PORT', defaultValue: '5000');
    final scheme = const bool.fromEnvironment('dart.vm.product') ? 'https' : 'http';
    return '$scheme://$ip:$port';
  }

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

  /// 🎁 Fetch Happy Hour / Loyalty Status
  Future<Map<String, dynamic>> fetchLoyaltyStatus() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/loyalty/status'))
          .timeout(const Duration(seconds: 5));
      
      if (response.statusCode == 200) {
        final decoded = json.decode(utf8.decode(response.bodyBytes));
        return decoded['data'] ?? {};
      }
    } catch (e) {
      debugPrint('Loyalty Status Error: $e');
    }
    return {'isHappyHourEnabled': false};
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
  
  static const _cacheTTL = Duration(minutes: 1);
  static const _longCacheTTL = Duration(minutes: 5);

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

  /// 🔐 JWT SECURITY LAYER: SINGLETON AUTO REFRESH & RETRY
  /// Handles 401 errors by attempting a token refresh and retrying the action.
  Future<T> _withRetry<T>(Future<T> Function() action, {int maxAttempts = 3, int refreshAttempts = 0}) async {
    int attempts = 0;
    while (true) {
      attempts++;
      try {
        return await action();
      } catch (e) {
        final errorStr = e.toString();
        
        // 1. Detect Authentication Errors (401)
        if (errorStr.contains('401') || errorStr.contains('SESSION_EXPIRED') || errorStr.contains('TOKEN_EXPIRED')) {
          
          // 🛡️ Loop Guard: Prevent infinite refresh loops
          if (refreshAttempts >= 1) {
            debugPrint('🚨 [Auth] Refresh loop detected. Session unrecoverable.');
            _triggerLogout();
            rethrow;
          }

          debugPrint('🔐 [Auth] Token Invalidation. Starting atomic refresh...');
          
          // 🥇 Atomic Singleton Refresh: All concurrent 401s will wait for this single future
          _refreshFuture ??= _attemptTokenRefresh();
          
          final isSuccess = await _refreshFuture;
          _refreshFuture = null; // Clear for next potential cycle

          if (isSuccess == true) {
            debugPrint('✅ [Auth] Session Restored. Retrying request...');
            return _withRetry(action, maxAttempts: maxAttempts, refreshAttempts: refreshAttempts + 1);
          } else {
            debugPrint('❌ [Auth] Refresh failed. Session unrecoverable.');
            _triggerLogout();
            rethrow;
          }
        }

        // 2. Detect Network Errors (Retry logic)
        if (attempts >= maxAttempts) {
          debugPrint('❌ [API] Max attempts reached: $errorStr');
          rethrow;
        }

        // Only retry on network issues, not client/server errors (except 401 handled above)
        if (errorStr.contains('Exception: Failed') || errorStr.contains('timeout') || errorStr.contains('Connection')) {
          final delay = Duration(seconds: attempts * 2);
          debugPrint('⚠️ [API] Network blip. Retrying in ${delay.inSeconds}s (Attempt $attempts)...');
          await Future.delayed(delay);
          continue;
        }
        
        rethrow;
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
        
        await SessionService.instance.saveTokens(
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

  // --- CORE DATA FETCHING ---

  Future<List<Category>> fetchCategories({bool forceRefresh = false}) async {
    return _withRetry(() async {
      if (!forceRefresh && _categoryCache != null && _categoryCacheTime != null) {
        if (DateTime.now().difference(_categoryCacheTime!) < _cacheTTL) return _categoryCache!;
      }
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
      }
      throw Exception('Failed to load categories');
    });
  }

  Future<List<MenuItem>> fetchMenuItems({bool forceRefresh = false}) async {
    return _withRetry(() async {
      if (!forceRefresh && _menuItemCache != null && _menuItemCacheTime != null) {
        if (DateTime.now().difference(_menuItemCacheTime!) < _cacheTTL) return _menuItemCache!;
      }
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
      }
      throw Exception('Failed to load menu items');
    });
  }

  Future<List<DeliveryZone>> fetchDeliveryZones({bool forceRefresh = false}) async {
    return _withRetry(() async {
      if (!forceRefresh && _deliveryZoneCache != null && _deliveryZoneCacheTime != null) {
        if (DateTime.now().difference(_deliveryZoneCacheTime!) < _longCacheTTL) return _deliveryZoneCache!;
      }
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
      }
      throw Exception('Failed to load delivery zones');
    });
  }

  // --- ORDERS ---

  Future<OrderModel?> fetchActiveOrder() async {
    try {
      final heads = await _headers;
      final orders = await _orderApi.fetchMyOrders(heads, page: 1, limit: 1);
      if (orders.isNotEmpty) {
        final order = orders.first;
        if (order.status != 'delivered' && order.status != 'cancelled') return order;
      }
      return null;
    } catch (e) {
      debugPrint('Fetch Active Order Error: $e');
      return null;
    }
  }

  Future<OrderModel?> placeOrder(OrderModel order) async {
    final heads = await _headers;
    return _withRetry(() => _orderApi.placeOrder(order, heads));
  }

  Future<List<OrderModel>> fetchCustomerOrders(String phone, {int page = 1, int limit = 10}) async {
    final heads = await _headers;
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

  /// 🕒 Silent Refresh: Proactively renew tokens before they expire
  void scheduleSilentRefresh(String accessToken) {
    _silentRefreshTimer?.cancel();
    
    // We assume a 1-hour expiry (3600s), refresh at 55 minutes (3300s)
    // In a real app, you'd decode the JWT 'exp' claim here.
    const refreshInterval = Duration(minutes: 55);
    
    debugPrint('🕒 [Auth] Silent refresh scheduled in 55 minutes.');
    _silentRefreshTimer = Timer(refreshInterval, () {
      debugPrint('🕒 [Auth] Executing scheduled silent refresh...');
      refreshTokens();
    });
  }

  // --- AUTH ---

  Future<Map<String, dynamic>> loginCustomer(String email, String password) async {
    final response = await _authApi.loginCustomer(email, password);
    await SessionService.instance.saveTokens(
      accessToken: response['accessToken'],
      refreshToken: response['refreshToken'],
    );
    await StorageService.instance.setCurrentUser(response['user']);
    
    if (response['accessToken'] != null) {
      scheduleSilentRefresh(response['accessToken']);
    }
    
    return response;
  }

  Future<Map<String, dynamic>> getMe() async {
    final token = await SessionService.instance.accessToken;
    if (token == null) throw Exception('No session found');
    final user = await _authApi.getMe(token);
    return user;
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

    return response;
  }

  Future<Map<String, dynamic>> fetchCustomerProfile(String email, String password) async {
    return loginCustomer(email, password);
  }

  // --- REVIEWS & SEARCH ---

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
      if (response.statusCode != 201) throw Exception('Failed to submit review');
    });
  }

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
    }
    throw Exception('Search failed');
  }

  // --- SINGLETON & TOKEN REFRESH ---

  static ApiService? _instance;
  static ApiService get instance {
    _instance ??= ApiService();
    return _instance!;
  }

  Future<String?> refreshTokens() async {
    try {
      String? refresh = await SessionService.instance.refreshToken;
      
      // 🛡️ User Fix: Fallback only if biometrics enabled AND token exists
      if (refresh == null) {
        final bioToken = await SessionService.instance.biometricToken;
        if (bioToken != null && StorageService.instance.isBiometricEnabled) {
          debugPrint('🔑 [Auth] Recovering via Biometric Token...');
          refresh = bioToken;
        }
      }

      if (refresh == null) return null;

      final response = await http.post(
        Uri.parse('$baseUrl/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({'refreshToken': refresh}),
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final body = json.decode(utf8.decode(response.bodyBytes));
        final data = body['data'] ?? body;
        final newAccessToken = data['accessToken'] as String?;
        final newRefreshToken = data['refreshToken'] as String?;

        if (newAccessToken != null) {
          await SessionService.instance.saveTokens(
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
          );
          if (newRefreshToken != null) {
            await SessionService.instance.saveBiometricToken(newRefreshToken);
          }
          
          scheduleSilentRefresh(newAccessToken);
          return newAccessToken;
        }
      }
      return null;
    } catch (e) {
      debugPrint('ApiService.refreshTokens failed: $e');
      return null;
    }
  }

  void _triggerLogout() {
    debugPrint('🚨 [Auth] Session unrecoverable. Emitting Expiry Event.');
    AppEvents.emit(SessionExpiredEvent());
  }
}
