import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../services/api_service.dart';
import '../../services/session_service.dart';
import '../../services/notification_service.dart';
import '../../models/order_model.dart';

class OrderController extends ChangeNotifier {
  final ApiService _api = ApiService();
  StreamSubscription? _statusSubscription;

  List<OrderModel> orders = [];
  bool isLoading = false;
  String? errorMessage;
  String? lastUpdatedOrderId;

  OrderController() {
    _initStatusListener();
  }

  void _initStatusListener() {
    _statusSubscription = NotificationService().orderUpdateStream.listen((data) {
      // 🔄 Handle Reconnect Sync Event
      if (data['type'] == 'sync_requested') {
        fetchOrders();
        return;
      }

      final orderId = data['orderId']?.toString();
      final status = data['status']?.toString();
      
      // 🛡️ Extract Ordering Metadata from Fingerprint
      final fingerprint = data['fingerprint'];
      int? version;
      int? incomingTimestamp;
      
      if (fingerprint != null) {
        version = fingerprint['version'] is int ? fingerprint['version'] : int.tryParse(fingerprint['version']?.toString() ?? '');
        incomingTimestamp = fingerprint['timestamp'];
      }
      
      if (orderId != null && status != null) {
        updateSingleOrder(
          orderId, 
          status, 
          version: version,
          incomingTimestamp: incomingTimestamp,
        );
      }
    });
  }

  @override
  void dispose() {
    _statusSubscription?.cancel();
    super.dispose();
  }

  List<OrderModel> get activeOrders => orders.where((o) => o.status != 'delivered' && o.status != 'cancelled').toList();
  List<OrderModel> get historyOrders => orders.where((o) => o.status == 'delivered' || o.status == 'cancelled').toList();

  // 📡 FETCH ORDERS (READ)
  Future<void> fetchOrders() async {
    final phone = SessionService.instance.phone;
    if (phone == null || phone.isEmpty) {
      errorMessage = "يرجى تسجيل الدخول لعرض الطلبات.";
      notifyListeners();
      return;
    }

    isLoading = true;
    errorMessage = null;
    notifyListeners();

    try {
      orders = await _api.fetchCustomerOrders(phone);
      
      // Ensure orders are sorted by newest first
      orders.sort((a, b) => b.timestamp.compareTo(a.timestamp));
      
      errorMessage = null;
    } catch (e) {
      errorMessage = "فشل في جلب الطلبات: ${e.toString().replaceAll('Exception: ', '')}";
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  // ⚡ REAL-TIME UPDATE (PUSH)
  void updateSingleOrder(String orderId, String status, {int? version, int? incomingTimestamp}) {
    final index = orders.indexWhere((o) => o.orderId == orderId);
    if (index != -1) {
      final localOrder = orders[index];
      if (localOrder.status == status) return; // No change
      
      // 🛡️ ADVANCED RACE SAFETY: Version + Timestamp Fallback
      if (version != null) {
        final bool isNewerVersion = version > localOrder.version;
        final bool isSameVersionButNewerTime = version == localOrder.version && 
            (incomingTimestamp != null && incomingTimestamp > localOrder.timestamp.millisecondsSinceEpoch);
            
        if (!isNewerVersion && !isSameVersionButNewerTime) {
          print('🕒 Out-of-order update ignored for $orderId: (v$version, t$incomingTimestamp) <= (v${localOrder.version}, t${localOrder.timestamp.millisecondsSinceEpoch})');
          return;
        }
      }
      
      // 📳 UX Polish: Subtle vibration based on status language
      _triggerStatusHaptic(status);
      
      orders[index].status = status;
      // We don't necessarily update 'version' locally unless we want to persist it, 
      // but let's update it to maintain consistency for the next guard check.
      // (Wait, OrderModel version is immutable in constructor, let's just update the list item)
      final updatedOrder = OrderModel(
        orderId: localOrder.orderId,
        orderNumber: localOrder.orderNumber,
        status: status,
        cancellationReason: localOrder.cancellationReason,
        cancellationStatus: localOrder.cancellationStatus,
        rejectionReason: localOrder.rejectionReason,
        timestamp: incomingTimestamp != null 
            ? DateTime.fromMillisecondsSinceEpoch(incomingTimestamp) 
            : localOrder.timestamp,
        estimatedReadyAt: localOrder.estimatedReadyAt,
        customerName: localOrder.customerName,
        customerPhone: localOrder.customerPhone,
        orderType: localOrder.orderType,
        extraDetails: localOrder.extraDetails,
        address: localOrder.address,
        notes: localOrder.notes,
        cartItems: localOrder.cartItems,
        totalPrice: localOrder.totalPrice,
        subtotal: localOrder.subtotal,
        deliveryFee: localOrder.deliveryFee,
        tax: localOrder.tax,
        rating: localOrder.rating,
        ratingText: localOrder.ratingText,
        ratingComment: localOrder.ratingComment,
        branch: localOrder.branch,
        deliveryZoneId: localOrder.deliveryZoneId,
        version: version ?? localOrder.version,
      );
      
      orders[index] = updatedOrder;
      lastUpdatedOrderId = orderId;
      
      print('🚀 Order $orderId locally updated to $status (v${updatedOrder.version})');
      notifyListeners();

      // Clear highlight after 3 seconds
      Timer(const Duration(seconds: 3), () {
        lastUpdatedOrderId = null;
        notifyListeners();
      });
    } else {
      // If order not found in current list, fetch everything to sync
      fetchOrders();
    }
  }

  void _triggerStatusHaptic(String status) {
    switch (status) {
      case 'confirmed':
      case 'preparing':
        HapticFeedback.lightImpact();
        break;
      case 'ready':
      case 'in_route':
        HapticFeedback.mediumImpact();
        break;
      case 'delivered':
        HapticFeedback.heavyImpact();
        break;
      default:
        HapticFeedback.selectionClick();
    }
  }

  // 🗑️ CANCEL ORDER
  Future<bool> cancelOrder(String orderId, String reason) async {
    final phone = SessionService.instance.phone;
    if (phone == null) return false;

    // --- Save old state for rollback ---
    final index = orders.indexWhere((o) => o.orderId == orderId);
    if (index == -1) return false;
    final oldStatus = orders[index].status;

    // --- Optimistic Update ---
    orders[index].status = 'cancelled';
    notifyListeners();

    try {
      await _api.cancelOrder(
        orderId: orderId,
        reason: reason,
        customerPhone: phone,
      );
      return true;
    } catch (e) {
      orders[index].status = oldStatus;
      errorMessage = e.toString().replaceAll('Exception: ', '');
      notifyListeners();
      return false;
    }
  }

  // ⭐ RATE ORDER
  Future<bool> rateOrder(String orderId, int rating, String comment) async {
    try {
      await _api.rateOrder(orderId, rating, comment);
      
      final index = orders.indexWhere((o) => o.orderId == orderId);
      if (index != -1) {
        orders[index].rating = rating;
        orders[index].ratingComment = comment;
        notifyListeners();
      }
      return true;
    } catch (e) {
      errorMessage = e.toString().replaceAll('Exception: ', '');
      notifyListeners();
      return false;
    }
  }
}
