import '../services/storage_service.dart';

class CartItem {
  final String id; // unique cart item id (e.g. productId_timestamp)
  final int productId;
  final String title;
  final String? titleEn;
  final String image;
  final double unitPrice; // basePrice + selected options
  int quantity;
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
    this.optionsText = '',
    this.optionsTextEn,
    this.optionIds = const [],
    this.note = '',
  });

  double get totalPrice => unitPrice * quantity;

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
      productId: json['productId'] ?? 0,
      title: json['title'] ?? '',
      titleEn: json['titleEn'],
      image: json['image'] ?? '',
      unitPrice: double.tryParse(json['unitPrice']?.toString() ?? '0') ?? 0.0,
      quantity: json['quantity'] ?? 1,
      optionsText: json['optionsText'] ?? '',
      optionsTextEn: json['optionsTextEn'],
      optionIds: (json['optionIds'] as List?)?.map((e) => e as int).toList() ?? [],
      note: json['note'] ?? '',
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
