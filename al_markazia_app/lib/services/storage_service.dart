import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/cart_item.dart';
import '../models/order_model.dart';
import '../models/menu_item.dart';

class StorageService extends ChangeNotifier {
  static final StorageService instance = StorageService._internal();
  StorageService._internal();

  late SharedPreferences _prefs;

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }

  // --- Theme ---
  bool getDarkMode() => _prefs.getBool('darkMode') ?? false;
  Future<void> setDarkMode(bool value) async {
    await _prefs.setBool('darkMode', value);
    notifyListeners();
  }

  // --- Localization ---
  String getLanguageCode() => _prefs.getString('languageCode') ?? 'ar';
  bool hasSelectedLanguage() => _prefs.getBool('hasSelectedLanguage') ?? false;

  Future<void> setLanguage(String code) async {
    await _prefs.setString('languageCode', code);
    await _prefs.setBool('hasSelectedLanguage', true);
    notifyListeners();
  }

  // --- Current User ---
  Map<String, dynamic>? getCurrentUser() {
    final str = _prefs.getString('currentUser');
    if (str != null) return json.decode(str);
    return null;
  }
  Future<void> setCurrentUser(Map<String, dynamic>? user) async {
    if (user == null) {
      await _prefs.remove('currentUser');
    } else {
      await _prefs.setString('currentUser', json.encode(user));
    }
    notifyListeners();
  }

  // --- Cart ---
  List<CartItem> getCart() {
    final str = _prefs.getString('cart');
    if (str != null) {
      final List list = json.decode(str);
      return list.map((e) => CartItem.fromJson(e)).toList();
    }
    return [];
  }
  
  Future<void> saveCart(List<CartItem> cart) async {
    await _prefs.setString('cart', json.encode(cart.map((e) => e.toJson()).toList()));
    notifyListeners();
  }
  
  Future<void> clearCart() async {
    await _prefs.remove('cart');
    notifyListeners();
  }

  // --- Favorites ---
  List<int> getFavorites() {
    final str = _prefs.getString('favorites');
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
    await _prefs.setString('favorites', json.encode(favs));
    notifyListeners();
  }

  // --- Orders ---
  List<OrderModel> getOrders() {
    final str = _prefs.getString('orders');
    if (str != null) {
      final List list = json.decode(str);
      return list.map((e) => OrderModel.fromJson(e)).toList();
    }
    return [];
  }

  Future<void> saveOrder(OrderModel order) async {
    final orders = getOrders();
    orders.add(order);
    await _prefs.setString('orders', json.encode(orders.map((e) => e.toJson()).toList()));
    notifyListeners();
  }
  
  Future<void> rateOrder(String orderId, int rating, String ratingText) async {
    final orders = getOrders();
    final idx = orders.indexWhere((o) => o.orderId == orderId);
    if (idx != -1) {
      orders[idx].rating = rating;
      orders[idx].ratingText = ratingText;
      await _prefs.setString('orders', json.encode(orders.map((e) => e.toJson()).toList()));
      notifyListeners();
    }
  }

  Future<void> replaceOrders(List<OrderModel> orders) async {
    await _prefs.setString('orders', json.encode(orders.map((e) => e.toJson()).toList()));
    notifyListeners();
  }

  Future<void> clearOrders() async {
    await _prefs.remove('orders');
    notifyListeners();
  }

  // --- Search History ---
  List<String> getRecentSearches() {
    return _prefs.getStringList('recentSearches') ?? [];
  }

  Future<void> addRecentSearch(String query) async {
    if (query.trim().isEmpty) return;
    final searches = getRecentSearches();
    searches.removeWhere((s) => s.toLowerCase() == query.trim().toLowerCase());
    searches.insert(0, query.trim());
    if (searches.length > 5) searches.removeLast();
    await _prefs.setStringList('recentSearches', searches);
    notifyListeners();
  }
}
