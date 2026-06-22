import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../models/cart_item.dart';
import '../models/order_model.dart';

/// 👤 Enterprise Storage Service (Identity & Settings Layer)
/// Handles non-sensitive persistent data like user profiles and app preferences.
class StorageService extends ChangeNotifier {
  static final StorageService instance = StorageService._internal();
  StorageService._internal();

  late SharedPreferences _prefs;
  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();

  // 🔒 In-memory cache for PII stored in SecureStorage (for sync access)
  String? _cachedEmail;
  String? _cachedPhone;

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    
    // 🔒 Migration: Move PII from SharedPreferences to SecureStorage (one-time)
    final legacyEmail = _prefs.getString('user_email');
    final legacyPhone = _prefs.getString('user_phone');
    if (legacyEmail != null) {
      await _secureStorage.write(key: 'user_email', value: legacyEmail);
      await _prefs.remove('user_email');
    }
    if (legacyPhone != null) {
      await _secureStorage.write(key: 'user_phone', value: legacyPhone);
      await _prefs.remove('user_phone');
    }
    
    // Load PII into memory cache for sync access
    _cachedEmail = await _secureStorage.read(key: 'user_email');
    _cachedPhone = await _secureStorage.read(key: 'user_phone');
  }

  // 🛡️ Data Isolation Layer (Rooms per user)
  String _userKey(String key) {
    final uuid = userId ?? 'guest';
    return 'u_${uuid}_$key';
  }

  // ── 👤 IDENTITY (Persists after Logout) ───────────────────────
  
  String? get userId => _prefs.getString('user_id');
  String? get userEmail => _cachedEmail;
  String? get userName => _prefs.getString('user_name');
  String? get userRole => _prefs.getString('user_role');
  String? get userPhone => _cachedPhone;
  int get userPoints => _prefs.getInt('user_points') ?? 0;
  String get userTier => _prefs.getString('user_tier') ?? 'SILVER';

  Future<void> saveIdentity({
    required String id,
    String? email,
    String? name,
    String? role,
    String? phone,
    int? points,
    String? tier,
  }) async {
    await _prefs.setString('user_id', id);
    if (email != null) {
      await _secureStorage.write(key: 'user_email', value: email);
      _cachedEmail = email;
    }
    if (name != null) await _prefs.setString('user_name', name);
    if (role != null) await _prefs.setString('user_role', role);
    if (phone != null) {
      await _secureStorage.write(key: 'user_phone', value: phone);
      _cachedPhone = phone;
    }
    if (points != null) await _prefs.setInt('user_points', points);
    if (tier != null) await _prefs.setString('user_tier', tier);
    notifyListeners();
  }

  /// 🚪 Logout Clear: Clears identity and user-specific data,
  /// but KEEPS the Email and Biometric settings for the next login.
  Future<void> clearIdentityOnLogout() async {
    // We keep 'user_email' in secure storage for the login screen identity/biometrics
    await _prefs.remove('user_id');
    await _prefs.remove('user_name');
    await _prefs.remove('user_role');
    await _secureStorage.delete(key: 'user_phone');
    _cachedPhone = null;
    await _prefs.remove('user_points');
    await _prefs.remove('user_tier');
    // Note: 'currentUser' JSON string is legacy, we use individual keys now
    await _prefs.remove('currentUser');
    notifyListeners();
  }

  // ── 🔒 SETTINGS (Always Persist) ──────────────────────────────
  
  bool get isBiometricEnabled => _prefs.getBool('biometricsEnabled') ?? false;
  Future<void> setBiometricEnabled(bool value) async {
    await _prefs.setBool('biometricsEnabled', value);
    notifyListeners();
  }

  bool getDarkMode() => _prefs.getBool('darkMode') ?? false;
  Future<void> setDarkMode(bool value) async {
    await _prefs.setBool('darkMode', value);
    notifyListeners();
  }

  String getLanguageCode() => _prefs.getString('languageCode') ?? 'ar';
  bool hasSelectedLanguage() => _prefs.getBool('hasSelectedLanguage') ?? false;

  Future<void> setLanguage(String code) async {
    await _prefs.setString('languageCode', code);
    await _prefs.setBool('hasSelectedLanguage', true);
    notifyListeners();
  }

  // ── 🛒 APP DATA (Cart, Favorites, etc.) ───────────────────────

  // --- Legacy Support ---
  Map<String, dynamic>? getCurrentUser() {
    final str = _prefs.getString('currentUser');
    if (str != null) return json.decode(str);
    if (userId != null) {
      return {
        'id': userId,
        'email': userEmail,
        'name': userName,
        'role': userRole,
        'phone': userPhone,
        'points': userPoints,
        'tier': userTier,
      };
    }
    return null;
  }

  Future<void> setCurrentUser(Map<String, dynamic>? user) async {
    if (user == null) {
      await clearIdentityOnLogout();
    } else {
      await saveIdentity(
        id: user['id']?.toString() ?? user['uuid']?.toString() ?? '',
        email: user['email'],
        name: user['name'],
        role: user['role'],
        phone: user['phone'],
        points: user['points'] != null ? int.tryParse(user['points'].toString()) : null,
        tier: user['tier'],
      );
    }
  }

  // --- Cart ---
  List<CartItem> getCart() {
    final str = _prefs.getString(_userKey('cart'));
    if (str != null) {
      final List list = json.decode(str);
      return list.map((e) => CartItem.fromJson(e)).toList();
    }
    return [];
  }
  
  Future<void> saveCart(List<CartItem> cart) async {
    await _prefs.setString(_userKey('cart'), json.encode(cart.map((e) => e.toJson()).toList()));
    notifyListeners();
  }
  
  Future<void> clearCart() async {
    await _prefs.remove(_userKey('cart'));
    notifyListeners();
  }

  // --- Favorites ---
  List<int> getFavorites() {
    final str = _prefs.getString(_userKey('favorites'));
    if (str != null) {
      return List<int>.from(json.decode(str));
    }
    return [];
  }
  
  Future<void> toggleFavorite(int id) async {
    final favs = getFavorites();
    if (favs.contains(id)) {
      favs.remove(id);
    } else {
      favs.add(id);
    }
    await _prefs.setString(_userKey('favorites'), json.encode(favs));
    notifyListeners();
  }

  // --- Orders ---
  List<OrderModel> getOrders() {
    final str = _prefs.getString(_userKey('orders'));
    if (str != null) {
      final List list = json.decode(str);
      return list.map((e) => OrderModel.fromJson(e)).toList();
    }
    return [];
  }

  Future<void> saveOrder(OrderModel order) async {
    final orders = getOrders();
    orders.add(order);
    await _prefs.setString(_userKey('orders'), json.encode(orders.map((e) => e.toJson()).toList()));
    notifyListeners();
  }
  
  Future<void> rateOrder(String orderId, int rating, String ratingText) async {
    final orders = getOrders();
    final idx = orders.indexWhere((o) => o.orderId == orderId);
    if (idx != -1) {
      orders[idx].rating = rating;
      orders[idx].ratingText = ratingText;
      await _prefs.setString(_userKey('orders'), json.encode(orders.map((e) => e.toJson()).toList()));
      notifyListeners();
    }
  }

  Future<void> replaceOrders(List<OrderModel> orders) async {
    await _prefs.setString(_userKey('orders'), json.encode(orders.map((e) => e.toJson()).toList()));
    notifyListeners();
  }

  Future<void> clearOrders() async {
    await _prefs.remove(_userKey('orders'));
    notifyListeners();
  }

  // --- Search History ---
  List<String> getRecentSearches() {
    return _prefs.getStringList(_userKey('recentSearches')) ?? [];
  }

  Future<void> addRecentSearch(String query) async {
    if (query.trim().isEmpty) return;
    final searches = getRecentSearches();
    searches.removeWhere((s) => s.toLowerCase() == query.trim().toLowerCase());
    searches.insert(0, query.trim());
    if (searches.length > 5) searches.removeLast();
    await _prefs.setStringList(_userKey('recentSearches'), searches);
    notifyListeners();
  }

  // --- Generic Accessors ---
  String? getString(String key) => _prefs.getString(key);
  Future<void> setString(String key, String value) async {
    await _prefs.setString(key, value);
    notifyListeners();
  }

  // --- Secure Storage (Encrypted) ---
  Future<void> setSecureString(String key, String value) async {
    await _secureStorage.write(key: key, value: value);
  }

  Future<String?> getSecureString(String key) async {
    return await _secureStorage.read(key: key);
  }

  Future<void> removeSecure(String key) async {
    await _secureStorage.delete(key: key);
  }
}
