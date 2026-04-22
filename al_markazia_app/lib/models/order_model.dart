import 'cart_item.dart';
import '../l10n/generated/app_localizations.dart';

class OrderModel {
  final String orderId;
  final String? orderNumber; 
  String? status;

  /// Compatibility alias — some UI code uses `order.id`
  String get id => orderId;      
  final String? cancellationReason;
  String? cancellationStatus; // 'pending', 'approved', 'rejected'
  String? rejectionReason;
  final DateTime timestamp;
  final DateTime? estimatedReadyAt; // New field for preparation timer
  final String customerName;
  final String customerPhone;
  final String orderType; 
  final String? extraDetails; 
  final String? address;
  final String? notes;
  final List<CartItem> cartItems;
  final double totalPrice;
  final double? subtotal;
  final double? deliveryFee;
  final double? tax;
  int? rating;
  String? ratingText;
  String? ratingComment;
  final String? branch;
  final String? deliveryZoneId;
  final int version; // 🛡️ Sequence Version for ordering logic

  OrderModel({
    required this.orderId,
    this.orderNumber,
    this.status,
    this.cancellationReason,
    this.cancellationStatus,
    this.rejectionReason,
    required this.timestamp,
    this.estimatedReadyAt,
    required this.customerName,
    required this.customerPhone,
    required this.orderType,
    this.extraDetails,
    this.address,
    this.notes,
    required this.cartItems,
    required this.totalPrice,
    this.subtotal,
    this.deliveryFee,
    this.tax,
    this.rating,
    this.ratingText,
    this.ratingComment,
    this.branch,
    this.deliveryZoneId,
    this.version = 1,
  });

  String getDisplayStatus(AppLocalizations l10n) {
    if (status != null && status!.isNotEmpty) {
      switch (status) {
        case 'pending': return '⏳ ${l10n.pending}';
        case 'confirmed': return '👨‍🍳 ${l10n.preparing}'; // Admin confirmed
        case 'preparing': return '⏱️ ${l10n.preparing}';
        case 'ready': return '🛍️ ${l10n.ready}';
        case 'in_route': return '🚚 ${l10n.inRoute}'; 
        case 'delivered': return '✅ ${l10n.delivered}';
        case 'cancelled': return '❌ ${l10n.cancel}';
        case 'waiting_cancellation': return '⌛ ${l10n.waitingCancellation}';
        default: return status!;
      }
    }
    return '⏳ ${l10n.pending}';
  }

  // Calculate remaining minutes for the timer
  int get remainingMinutes {
    if (estimatedReadyAt == null) return 0;
    final diff = estimatedReadyAt!.difference(DateTime.now()).inMinutes;
    return diff > 0 ? diff : 0;
  }

  double get progress {
    if (status == 'delivered') return 1.0;
    if (status == 'ready' || status == 'in_route') return 0.75;
    if (status == 'preparing' || status == 'waiting_cancellation') return 0.50;
    if (status == 'confirmed') return 0.25;
    return 0.1;
  }

  factory OrderModel.fromJson(Map<String, dynamic> json) {
    return OrderModel(
      orderId: (json['id'] ?? json['orderId'] ?? '').toString(),
      orderNumber: json['orderNumber']?.toString(),
      status: json['status']?.toString(),
      cancellationReason: json['cancellation']?['reason'],
      cancellationStatus: json['cancellation']?['status'],
      rejectionReason: json['cancellation']?['rejectionReason'],
      timestamp: DateTime.parse(json['timestamp'] ?? json['createdAt'] ?? DateTime.now().toIso8601String()),
      estimatedReadyAt: json['estimatedReadyAt'] != null 
          ? DateTime.parse(json['estimatedReadyAt']) 
          : null,
      customerName: json['customerName'] ?? 'Customer',
      customerPhone: json['customerPhone'] ?? '',
      orderType: json['orderType'] ?? 'takeaway',
      extraDetails: json['extraDetails'] as String? ?? json['notes'] as String?,
      address: json['address'],
      notes: json['notes'],
      cartItems: (json['cartItems'] as List? ?? [])
          .map((i) => CartItem.fromJson(i))
          .toList(),
      totalPrice: double.tryParse((json['totalPrice'] ?? json['total'])?.toString() ?? '0') ?? 0.0,
      subtotal: double.tryParse(json['subtotal']?.toString() ?? '0'),
      deliveryFee: double.tryParse(json['deliveryFee']?.toString() ?? '0'),
      tax: double.tryParse(json['tax']?.toString() ?? '0'),
      rating: json['rating'],
      ratingText: json['ratingText'],
      ratingComment: json['ratingComment'],
      branch: json['branch'],
      deliveryZoneId: json['deliveryZoneId'],
      version: json['version'] ?? 1,
    );
  }

  Map<String, dynamic> toJson() => {
    'orderId': orderId,
    'orderNumber': orderNumber,
    'status': status,
    'timestamp': timestamp.toIso8601String(),
    'estimatedReadyAt': estimatedReadyAt?.toIso8601String(),
    'customerName': customerName,
    'customerPhone': customerPhone,
    'orderType': orderType,
    'extraDetails': extraDetails,
    'address': address,
    'notes': notes,
    'cartItems': cartItems.map((e) => e.toJson()).toList(),
    'totalPrice': totalPrice,
    'subtotal': subtotal,
    'deliveryFee': deliveryFee,
    'tax': tax,
    'rating': rating,
    'ratingText': ratingText,
    'ratingComment': ratingComment,
    'branch': branch,
    'deliveryZoneId': deliveryZoneId,
    'version': version,
  };
}
