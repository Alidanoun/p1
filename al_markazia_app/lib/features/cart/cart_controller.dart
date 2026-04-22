import 'package:flutter/material.dart';
import '../../models/cart_item.dart';
import '../../services/storage_service.dart';

class CartController extends ChangeNotifier {
  final StorageService _storage;
  List<CartItem> _items = [];

  CartController({StorageService? storageService}) 
      : _storage = storageService ?? StorageService.instance {
    _loadFromStorage();
  }

  // --- Getters ---
  List<CartItem> get items => List.unmodifiable(_items);
  int get itemCount => _items.length;
  bool get isEmpty => _items.isEmpty;

  double get subtotal => _items.fold(0.0, (sum, item) => sum + item.totalPrice);
  double get totalPrice => subtotal; // For now, simple alias. Checkout handles fees.

  // --- Persistence Sync ---
  void _loadFromStorage() {
    _items = _storage.getCart();
    notifyListeners();
  }

  Future<void> _syncToStorage() async {
    await _storage.saveCart(_items);
  }

  // --- Actions ---
  Future<void> addItem(CartItem newItem) async {
    // Check if same product with same options exists to increment quantity
    final existingIndex = _items.indexWhere((item) => 
      item.productId == newItem.productId && 
      item.optionsText == newItem.optionsText
    );

    if (existingIndex != -1) {
      _items[existingIndex].quantity += newItem.quantity;
    } else {
      _items.add(newItem);
    }

    notifyListeners();
    await _syncToStorage();
  }

  Future<void> updateQuantity(int index, int delta) async {
    if (index < 0 || index >= _items.length) return;
    
    final newQty = _items[index].quantity + delta;
    if (newQty < 1) {
      await removeItem(index);
    } else {
      _items[index].quantity = newQty;
      notifyListeners();
      await _syncToStorage();
    }
  }

  Future<void> setQuantity(int index, int quantity) async {
    if (index < 0 || index >= _items.length) return;
    if (quantity < 1) {
      await removeItem(index);
    } else {
      _items[index].quantity = quantity;
      notifyListeners();
      await _syncToStorage();
    }
  }

  Future<void> removeItem(int index) async {
    if (index < 0 || index >= _items.length) return;
    _items.removeAt(index);
    notifyListeners();
    await _syncToStorage();
  }

  Future<void> clearCart() async {
    _items.clear();
    notifyListeners();
    await _storage.clearCart();
  }

  Future<void> replaceCart(List<CartItem> newItems) async {
    _items = List.from(newItems);
    notifyListeners();
    await _syncToStorage();
  }
}
