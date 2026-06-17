import '../services/storage_service.dart';

class CartItem {
  final String id; // unique cart item id (e.g. productId_timestamp)
  final int productId;
  final String title;
  final String? titleEn;
  final String image;
  final double unitPrice; // basePrice + selected options
  int quantity;
  final double? lineTotal;
  final String optionsText;
  final String? optionsTextEn;
  final List<int> optionIds;
  final String note;

  CartItem({
    required this.id,
    required this.productId,
    required this.title,
    this.titleEn,
    required this.image,
    required this.unitPrice,
    this.quantity = 1,
    this.lineTotal,
    this.optionsText = '',
    this.optionsTextEn,
    this.optionIds = const [],
    this.note = '',
  });

  double get totalPrice {
    if (lineTotal != null) {
      return lineTotal!;
    }
    return unitPrice * quantity;
  }

  String get displayTitle {
    final lang = StorageService.instance.getLanguageCode();
    if (lang == 'en' && titleEn != null && titleEn!.isNotEmpty) {
      return titleEn!;
    }
    return title;
  }

  String get displayOptionsText {
    final lang = StorageService.instance.getLanguageCode();
    if (lang == 'en' && optionsTextEn != null && optionsTextEn!.isNotEmpty) {
      return optionsTextEn!;
    }
    return optionsText;
  }

  factory CartItem.fromJson(Map<String, dynamic> json) {
    return CartItem(
      id: json['id'] ?? '',
      productId: json['productId'] ?? json['itemId'] ?? 0,
      title: json['title'] ?? json['itemName'] ?? '',
      titleEn: json['titleEn'] ?? json['itemNameEn'],
      image: json['image'] ?? '',
      unitPrice: double.tryParse(json['unitPrice']?.toString() ?? '0') ?? 0.0,
      quantity: json['quantity'] ?? json['qty'] ?? 1,
      lineTotal: json['lineTotal'] != null ? double.tryParse(json['lineTotal'].toString()) : null,
      optionsText: json['optionsText'] ?? json['selectedOptions'] ?? '',
      optionsTextEn: json['optionsTextEn'] ?? json['selectedOptionsEn'],
      optionIds: (json['optionIds'] as List?)?.map((e) => e as int).toList() ?? [],
      note: json['note'] ?? json['notes'] ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'productId': productId,
    'title': title,
    'titleEn': titleEn,
    'image': image,
    'unitPrice': unitPrice,
    'quantity': quantity,
    'optionsText': optionsText,
    'optionsTextEn': optionsTextEn,
    'optionIds': optionIds,
    'note': note,
  };
}
