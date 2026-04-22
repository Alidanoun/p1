class DeliveryZone {
  final String id;
  final String nameAr;
  final String? nameEn;
  final double fee;
  final double? minOrder;
  final bool isActive;
  final int sortOrder;

  // Legacy Compatibility Aliases
  String get name => nameAr;
  double get price => fee;

  DeliveryZone({
    required this.id,
    required this.nameAr,
    this.nameEn,
    required this.fee,
    this.minOrder,
    this.isActive = true,
    this.sortOrder = 0,
  });

  factory DeliveryZone.fromJson(Map<String, dynamic> json) {
    return DeliveryZone(
      id: json['id'] ?? '',
      nameAr: json['nameAr'] ?? '',
      nameEn: json['nameEn'],
      fee: (json['fee'] is num) ? (json['fee'] as num).toDouble() : double.tryParse(json['fee']?.toString() ?? '0') ?? 0.0,
      minOrder: json['minOrder'] != null ? (json['minOrder'] is num ? (json['minOrder'] as num).toDouble() : double.tryParse(json['minOrder'].toString())) : null,
      isActive: json['isActive'] ?? true,
      sortOrder: json['sortOrder'] ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'nameAr': nameAr,
      'nameEn': nameEn,
      'fee': fee,
      'minOrder': minOrder,
      'isActive': isActive,
      'sortOrder': sortOrder,
    };
  }
}
