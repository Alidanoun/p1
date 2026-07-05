import 'package:flutter/foundation.dart' hide Category;
import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/menu_item.dart';
import '../models/order_model.dart';
import '../models/restaurant_status.dart';
import '../models/branch_model.dart';
import '../features/checkout/models/delivery_zone.dart';
import '../core/errors/app_exception.dart';
import 'api/auth_api.dart';
import 'api/order_api.dart';
import 'api/loyalty_api.dart';
import 'api/menu_api.dart';
import 'session_service.dart';
import 'storage_service.dart';
import 'app_events.dart';
import 'package:uuid/uuid.dart';

/// 🏥 Enterprise API Service (Intelligent Interceptor & Resilience Layer)
/// Orchestrates sub-APIs and owns the JWT retry/refresh cycle.
class ApiService {
  final _authApi = AuthApi();
  final _orderApi = OrderApi();
  final _loyaltyApi = LoyaltyApi();
  final _menuApi = MenuApi();
  
  // 🕒 Silent Refresh Management
  Timer? _silentRefreshTimer;

  static String get baseUrl {
    return const String.fromEnvironment('API_URL', defaultValue: 'http://10.216.143.143:5000/api/v1');
  }

  /// 🔌 Socket Base URL (without /api/v1 prefix — Socket.IO connects to root)
  static String get socketUrl {
    return const String.fromEnvironment('SOCKET_URL', defaultValue: 'http://10.216.143.143:5000');
  }

  /// 🏥 Fetch Restaurant Operational Status
  Future<RestaurantStatus> fetchRestaurantStatus() async {
    return _withRetry(() async {
      final response = await http.get(Uri.parse('$baseUrl/restaurant/status'))
          .timeout(const Duration(seconds: 8));
      
      if (response.statusCode == 200) {
        final decoded = json.decode(utf8.decode(response.bodyBytes));
        return RestaurantStatus.fromJson(decoded['data']);
      }
      
      // If we get an error but not a timeout/network issue, we still return a fallback
      // but _withRetry will handle retries for network issues.
      return RestaurantStatus(
        isOpen: false, 
        isEmergency: true, 
        reason: 'تعذر الحصول على حالة المطعم (خطأ ${response.statusCode})'
      );
    }, maxAttempts: 2);
  }

  /// 🎁 Fetch Happy Hour / Loyalty Status
  Future<Map<String, dynamic>> fetchLoyaltyStatus() async {
    return _withRetry(() async {
      final heads = await _headers;
      return _loyaltyApi.fetchLoyaltyStatus(heads);
    }, maxAttempts: 2);
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

  /// 📊 Request Logger: logs method, URL, status code, and duration.
  void _logRequest(String method, String url, int statusCode, Duration elapsed) {
    final emoji = statusCode >= 200 && statusCode < 300 ? '✅' : statusCode >= 500 ? '🔴' : '🟡';
    debugPrint(
      '$emoji [API] $method $url → $statusCode (${elapsed.inMilliseconds}ms)',
    );
  }

  /// 🔐 JWT SECURITY LAYER: SINGLETON AUTO REFRESH & RETRY
  ///
  /// Error handling strategy:
  /// - 401/AuthException  → atomic singleton token refresh → retry once → logout
  /// - NetworkException   → exponential backoff retry up to [maxAttempts]
  /// - 5xx ServerException → no retry (server-side fault, not transient)
  /// - other              → rethrow immediately
  Future<T> _withRetry<T>(
    Future<T> Function() action, {
    int maxAttempts = 3,
    int refreshAttempts = 0,
  }) async {
    int attempts = 0;
    while (true) {
      attempts++;
      try {
        return await action();
      } on AuthException {
        // ── Auth failure path ──────────────────────────────────────────────
        if (refreshAttempts >= 1) {
          debugPrint('🚨 [Auth] Refresh loop detected. Session unrecoverable.');
          _triggerLogout();
          rethrow;
        }
        debugPrint('🔐 [Auth] Token invalidated. Starting atomic refresh...');
        _refreshFuture ??= _attemptTokenRefresh();
        final isSuccess = await _refreshFuture;
        _refreshFuture = null;
        if (isSuccess == true) {
          debugPrint('✅ [Auth] Session restored. Retrying request...');
          return _withRetry(action, maxAttempts: maxAttempts, refreshAttempts: refreshAttempts + 1);
        } else {
          debugPrint('❌ [Auth] Refresh failed. Session unrecoverable.');
          _triggerLogout();
          rethrow;
        }
      } on NetworkException {
        // ── Network failure path (retry with backoff) ──────────────────────
        if (attempts >= maxAttempts) {
          debugPrint('❌ [API] Max retry attempts ($maxAttempts) reached. Giving up.');
          rethrow;
        }
        final delay = Duration(seconds: attempts * 2);
        debugPrint('⚠️ [API] Network blip. Retrying in ${delay.inSeconds}s ($attempts/$maxAttempts)...');
        await Future.delayed(delay);
        continue;
      } on ServerException {
        // ── Server 5xx: do not retry, surface immediately ──────────────────
        debugPrint('🔴 [API] Server error. Not retrying.');
        rethrow;
      } catch (e) {
        // ── Legacy string-based detection (fallback for http.* exceptions) ──
        final errorStr = e.toString();
        final isAuthError = errorStr.contains('401') ||
            errorStr.contains('SESSION_EXPIRED') ||
            errorStr.contains('TOKEN_EXPIRED');
        if (isAuthError) {
          if (refreshAttempts >= 1) {
            _triggerLogout();
            rethrow;
          }
          _refreshFuture ??= _attemptTokenRefresh();
          final ok = await _refreshFuture;
          _refreshFuture = null;
          if (ok == true) {
            return _withRetry(action, maxAttempts: maxAttempts, refreshAttempts: refreshAttempts + 1);
          }
          _triggerLogout();
          rethrow;
        }
        final isNetworkError = errorStr.contains('SocketException') ||
            errorStr.contains('TimeoutException') ||
            errorStr.contains('Connection refused') ||
            errorStr.contains('Failed host lookup') ||
            errorStr.contains('timeout');
        if (isNetworkError && attempts < maxAttempts) {
          final delay = Duration(seconds: attempts * 2);
          debugPrint('⚠️ [API] Network blip. Retrying in ${delay.inSeconds}s...');
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
      final result = await _menuApi.fetchCategories(heads);
      _categoryCache = result;
      _categoryCacheTime = DateTime.now();
      return result;
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
      final result = await _menuApi.fetchMenuItems(heads);
      _menuItemCache = result;
      _menuItemCacheTime = DateTime.now();
      return result;
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
      final result = await _menuApi.fetchDeliveryZones(heads);
      _deliveryZoneCache = result;
      _deliveryZoneCacheTime = DateTime.now();
      return result;
    });
  }

  Future<List<BranchModel>> fetchBranches() async {
    return _withRetry(() async {
      final heads = await _headers;
      return _menuApi.fetchBranches(heads);
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
    // الباك إند يشترط أن يكون idempotency-key بصيغة UUID v4
    heads['idempotency-key'] = const Uuid().v4();
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
    
    Duration refreshInterval = const Duration(minutes: 12); // Fallback

    try {
      final parts = accessToken.split('.');
      if (parts.length == 3) {
        final payload = utf8.decode(base64Url.decode(base64Url.normalize(parts[1])));
        final payloadMap = json.decode(payload);
        if (payloadMap['exp'] != null) {
          final expiryDate = DateTime.fromMillisecondsSinceEpoch(payloadMap['exp'] * 1000);
          final timeUntilExpiry = expiryDate.difference(DateTime.now());
          refreshInterval = timeUntilExpiry - const Duration(minutes: 2);
          if (refreshInterval.isNegative) {
            refreshInterval = Duration.zero;
          }
        }
      }
    } catch (e) {
      debugPrint('Error decoding JWT for refresh: $e');
    }
    
    debugPrint('🕒 [Auth] Silent refresh scheduled in ${refreshInterval.inMinutes} minutes.');
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
    String? referralCode,
  }) async {
    final response = await _authApi.registerCustomer(
      name: name,
      email: email,
      password: password,
      phone: phone,
      referralCode: referralCode,
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
      if (response.statusCode != 201) {
        try {
          final Map<String, dynamic> errorData = json.decode(utf8.decode(response.bodyBytes));
          final errorMsg = errorData['error'] ?? errorData['message'] ?? 'Failed to submit review';
          throw Exception(errorMsg);
        } catch (e) {
          if (e is Exception && !e.toString().contains('Failed to submit review')) {
            rethrow;
          }
          throw Exception('Failed to submit review');
        }
      }
    });
  }

  Future<List<MenuItem>> searchItems(String query) async {
    return _withRetry(() => _menuApi.searchItems(query));
  }

  // --- 🎁 REWARDS STORE & LOYALTY (delegated to LoyaltyApi) ---

  Future<List<dynamic>> fetchRewardsStore() async {
    return _withRetry(() async {
      final heads = await _headers;
      return _loyaltyApi.fetchRewardsStore(heads);
    });
  }

  Future<Map<String, dynamic>> fetchLoyaltyProfile() async {
    return _withRetry(() async {
      final heads = await _headers;
      return _loyaltyApi.fetchLoyaltyProfile(heads);
    });
  }

  Future<List<dynamic>> fetchLoyaltyLedger() async {
    return _withRetry(() async {
      final heads = await _headers;
      return _loyaltyApi.fetchLoyaltyLedger(heads);
    });
  }

  Future<Map<String, dynamic>> fetchSystemConfig() async {
    return _withRetry(() async {
      final heads = await _headers;
      final response = await http
          .get(Uri.parse('$baseUrl/system/config'), headers: heads)
          .timeout(const Duration(seconds: 10));
      if (response.statusCode == 401) throw const AuthException();
      if (response.statusCode == 200) {
        final decoded = json.decode(utf8.decode(response.bodyBytes));
        return decoded['data'] as Map<String, dynamic>;
      }
      throw ServerException('فشل تحميل إعدادات النظام.', response.statusCode);
    });
  }

  Future<Map<String, dynamic>> claimReward(int rewardId) async {
    return _withRetry(() async {
      final heads = await _headers;
      return _loyaltyApi.claimReward(rewardId, heads);
    });
  }

  Future<Map<String, dynamic>?> triggerSocialShareReward() async {
    final heads = await _headers;
    return _loyaltyApi.triggerSocialShareReward(heads);
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

  /// 🛠️ Flexible HTTP Method Hook supporting distributed concurrency headers
  Future<http.Response> rawRequest(
    String endpoint, 
    String method, {
    Map<String, dynamic>? body,
    Map<String, String>? additionalHeaders,
  }) async {
    return _withRetry(() async {
      final baseHeads = await _headers;
      final finalHeaders = {
        ...baseHeads,
        if (additionalHeaders != null) ...additionalHeaders,
      };

      final uri = Uri.parse(endpoint.startsWith('http') ? endpoint : '$baseUrl$endpoint');
      final encodedBody = body != null ? json.encode(body) : null;

      final stopwatch = Stopwatch()..start();
      http.Response response;
      switch (method.toUpperCase()) {
        case 'POST':
          response = await http.post(uri, headers: finalHeaders, body: encodedBody).timeout(const Duration(seconds: 12));
        case 'PUT':
          response = await http.put(uri, headers: finalHeaders, body: encodedBody).timeout(const Duration(seconds: 12));
        case 'PATCH':
          response = await http.patch(uri, headers: finalHeaders, body: encodedBody).timeout(const Duration(seconds: 12));
        case 'DELETE':
          response = await http.delete(uri, headers: finalHeaders, body: encodedBody).timeout(const Duration(seconds: 12));
        default:
          response = await http.get(uri, headers: finalHeaders).timeout(const Duration(seconds: 12));
      }
      stopwatch.stop();
      _logRequest(method.toUpperCase(), uri.toString(), response.statusCode, stopwatch.elapsed);
      return response;
    });
  }
}
