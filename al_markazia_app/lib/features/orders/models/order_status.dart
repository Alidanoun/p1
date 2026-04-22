enum OrderStatus {
  pending,
  preparing,
  ready,
  outForDelivery,
  completed,
  cancelled,
  unknown
}

extension OrderStatusExtension on OrderStatus {
  String get value {
    switch (this) {
      case OrderStatus.outForDelivery:
        return 'out_for_delivery';
      default:
        return toString().split('.').last;
    }
  }

  static OrderStatus fromString(String status) {
    switch (status.toLowerCase()) {
      case 'pending':
        return OrderStatus.pending;
      case 'preparing':
        return OrderStatus.preparing;
      case 'ready':
        return OrderStatus.ready;
      case 'out_for_delivery':
        return OrderStatus.outForDelivery;
      case 'completed':
        return OrderStatus.completed;
      case 'cancelled':
        return OrderStatus.cancelled;
      default:
        return OrderStatus.unknown;
    }
  }
}
