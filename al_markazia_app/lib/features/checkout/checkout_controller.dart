import 'package:flutter/material.dart';
import '../../models/order_model.dart';
import '../../models/cart_item.dart';
import '../cart/cart_controller.dart';
import '../checkout/models/delivery_zone.dart';
import '../../services/api_service.dart';
import '../../services/session_service.dart';
import '../../services/storage_service.dart';
import '../../l10n/generated/app_localizations.dart';

class CheckoutController extends ChangeNotifier {
  final ApiService _api;
  final StorageService _storage;

  CheckoutController({ApiService? apiService, StorageService? storageService}) 
      : _api = apiService ?? ApiService(),
        _storage = storageService ?? StorageService.instance;

  // ❄️ Snapshot Data (ReadOnly)
  List<CartItem> _snapshotItems = [];
  double _subtotal = 0.0;

  List<CartItem> get snapshotItems => _snapshotItems;
  double get subtotal => _subtotal;

  // 📦 Order Context (State)
  String orderType = 'delivery'; // 'delivery' or 'takeaway'
  String? selectedBranch;
  List<DeliveryZone> zones = [];
  DeliveryZone? selectedZone;
  double deliveryFee = 0.0;
  
  String customerName = '';
  String customerPhone = '';
  String street = '';
  String building = '';
  String notes = '';
  
  String pickupTiming = 'asap'; // 'asap' or 'atTime'
  TimeOfDay? selectedTime;

  bool isLoading = false;
  String? errorMessage;

  Map<String, dynamic>? loyaltyConfig;

  // ❄️ Initialize Snapshot (The Golden Rule)
  void initialize(CartController cartController) {
    // Take a frozen copy
    _snapshotItems = List.from(cartController.items);
    _subtotal = cartController.subtotal;
    
    // Default user info
    customerName = SessionService.instance.name ?? '';
    customerPhone = SessionService.instance.phone ?? '';
    
    // Reset state for new checkout
    deliveryFee = 0.0;
    selectedZone = null;
    errorMessage = null;
    isLoading = false;
    
    // Fetch fresh zones and loyalty config in background
    fetchZones();
    fetchLoyaltyConfig();
    
    notifyListeners();
  }

  Future<void> fetchZones() async {
    try {
      zones = await _api.fetchDeliveryZones();
      notifyListeners();
    } catch (e) {
      print('Error fetching zones: $e');
    }
  }

  Future<void> fetchLoyaltyConfig() async {
    try {
      loyaltyConfig = await _api.fetchLoyaltyStatus();
      notifyListeners();
    } catch (e) {
      print('Error fetching loyalty config: $e');
    }
  }

  // ⚙️ Logic
  void setOrderType(String type) {
    orderType = type;
    if (orderType == 'takeaway') {
      deliveryFee = 0.0;
      selectedZone = null;
    }
    notifyListeners();
  }

  void setZone(DeliveryZone zone) {
    selectedZone = zone;
    deliveryFee = zone.price;
    notifyListeners();
  }

  void setBranch(String branch) {
    selectedBranch = branch;
    notifyListeners();
  }

  void updatePickupTiming(String timing) {
    pickupTiming = timing;
    notifyListeners();
  }

  void updateSelectedTime(TimeOfDay? time) {
    selectedTime = time;
    notifyListeners();
  }

  double get total => _subtotal + (orderType == 'delivery' ? deliveryFee : 0.0);

  int get estimatedPoints {
    if (loyaltyConfig == null) return 0;
    
    final pointsPerJod = (loyaltyConfig!['pointsPerJod'] as num?)?.toDouble() ?? 10.0;
    final happyMultiplier = (loyaltyConfig!['happyHourMultiplier'] as num?)?.toDouble() ?? 1.0;
    final isHappyHour = loyaltyConfig!['isHappyHourEnabled'] == true && 
                        loyaltyConfig!['happyHourStatus']?['isActive'] == true;

    double multiplier = 1.0;
    final tier = _storage.userTier;
    if (tier == 'GOLD') {
      multiplier = (loyaltyConfig!['pointsMultiplierGold'] as num?)?.toDouble() ?? 1.5;
    } else if (tier == 'PLATINUM') {
      multiplier = (loyaltyConfig!['pointsMultiplierPlatinum'] as num?)?.toDouble() ?? 2.0;
    }

    if (isHappyHour) {
      multiplier *= happyMultiplier;
    }

    return (_subtotal * pointsPerJod * multiplier).floor();
  }

  bool get isMinOrderSatisfied {
    if (orderType != 'delivery' || selectedZone == null) return true;
    final minOrder = selectedZone?.minOrder ?? 0.0;
    return _subtotal >= minOrder;
  }

  String? getMinOrderWarning(AppLocalizations l10n) {
    if (orderType != 'delivery' || selectedZone == null) return null;
    final minOrder = selectedZone?.minOrder ?? 0.0;
    if (_subtotal < minOrder) {
      return "${l10n.minOrderWarningPrefix}${minOrder.toStringAsFixed(2)} ${l10n.currency}${l10n.minOrderWarningMissing}${(minOrder - _subtotal).toStringAsFixed(2)} ${l10n.currency}";
    }
    return null;
  }

  // 🚀 SUBMIT FLOW
  Future<OrderModel?> confirmOrder(CartController liveCart, AppLocalizations l10n) async {
    errorMessage = null;
    isLoading = true;
    notifyListeners();

    try {
      // 1️⃣ Final Validation against LIVE Cart
      if (liveCart.itemCount != _snapshotItems.length) {
         throw Exception(l10n.cartChangedError);
      }
      
      // Check for price changes (Simplified for now, could be per item)
      if ((liveCart.subtotal - _subtotal).abs() > 0.01) {
         throw Exception(l10n.priceChangedError);
      }

      // 3️⃣ Minimum Order Validation
      if (!isMinOrderSatisfied) {
        throw Exception(getMinOrderWarning(l10n) ?? l10n.minOrderError);
      }

      // 2️⃣ Build Order Model
      final order = OrderModel(
        orderId: 'ORD-${DateTime.now().millisecondsSinceEpoch}',
        timestamp: DateTime.now(),
        customerName: customerName,
        customerPhone: customerPhone,
        orderType: orderType == 'delivery' ? 'delivery' : 'pickup',
        address: orderType == 'delivery' 
            ? '${l10n.addressAreaLabel}: ${selectedZone?.name}\n${l10n.addressStreetLabel}: $street - ${l10n.addressBuildingLabel}: $building' 
            : null,
        notes: notes,
        cartItems: _snapshotItems,
        totalPrice: total,
        subtotal: _subtotal,
        deliveryFee: orderType == 'delivery' ? deliveryFee : 0.0,
        branch: selectedBranch,
        deliveryZoneId: orderType == 'delivery' ? selectedZone?.id : null,
      );

      // 3️⃣ Send to API
      final sentOrder = await _api.placeOrder(order);
      
      if (sentOrder != null) {
        // 4️⃣ Clear LIVE Cart only on success
        await liveCart.clearCart();
        
        // Save to local history as well (legacy compatibility)
        await _storage.saveOrder(sentOrder);
      }

      isLoading = false;
      notifyListeners();
      return sentOrder;

    } catch (e) {
      isLoading = false;
      errorMessage = e.toString().replaceAll('Exception: ', '');
      notifyListeners();
      return null;
    }
  }
}

