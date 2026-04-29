class RestaurantStatus {
  final bool isOpen;
  final bool isEmergency;
  final String? closureType;
  final String? reason;
  final String? reasonEn;
  final DateTime? nextOpenAt;
  final DateTime? closingAt;

  RestaurantStatus({
    required this.isOpen,
    required this.isEmergency,
    this.closureType,
    this.reason,
    this.reasonEn,
    this.nextOpenAt,
    this.closingAt,
  });

  factory RestaurantStatus.fromJson(Map<String, dynamic> json) {
    return RestaurantStatus(
      isOpen: json['isOpen'] ?? true,
      isEmergency: json['isEmergency'] ?? false,
      closureType: json['closureType'],
      reason: json['reason'],
      reasonEn: json['reasonEn'],
      nextOpenAt: json['nextOpenAt'] != null ? DateTime.parse(json['nextOpenAt']) : null,
      closingAt: json['closingAt'] != null ? DateTime.parse(json['closingAt']) : null,
    );
  }

  bool get isOpeningSoon {
    if (isOpen || nextOpenAt == null) return false;
    final diff = nextOpenAt!.difference(DateTime.now());
    return diff.inMinutes > 0 && diff.inMinutes <= 60;
  }
}
