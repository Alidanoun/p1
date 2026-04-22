import '../services/storage_service.dart';

class Option {
  final int id;
  final String name;
  final String? nameEn;
  final double price;
  final bool isAvailable;
  final bool isDefault;

  Option({
    required this.id,
    required this.name,
    this.nameEn,
    required this.price,
    this.isAvailable = true,
    this.isDefault = false,
  });

  factory Option.fromJson(Map<String, dynamic> json) {
    return Option(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id'].toString()) ?? 0,
      name: json['name'] ?? '',
      nameEn: json['nameEn'],
      price: double.tryParse(json['price']?.toString() ?? '0') ?? 0.0,
      isAvailable: json['isAvailable'] ?? true,
      isDefault: json['isDefault'] ?? false,
    );
  }

  String get displayName {
    final lang = StorageService.instance.getLanguageCode();
    if (lang == 'en' && nameEn != null && nameEn!.isNotEmpty) {
      return nameEn!;
    }
    return name;
  }
}

class OptionGroup {
  final int id;
  final String groupName;
  final String? groupNameEn;
  final String type; // SINGLE, MULTIPLE
  final bool isRequired;
  final List<Option> options;

  OptionGroup({
    required this.id,
    required this.groupName,
    this.groupNameEn,
    required this.type,
    required this.isRequired,
    required this.options,
  });

  factory OptionGroup.fromJson(Map<String, dynamic> json) {
    return OptionGroup(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id'].toString()) ?? 0,
      groupName: json['groupName'] ?? '',
      groupNameEn: json['groupNameEn'],
      type: json['type'] ?? 'SINGLE',
      isRequired: json['isRequired'] ?? false,
      options: json['options'] != null 
          ? List<Option>.from(json['options'].map((x) => Option.fromJson(x)))
          : [],
    );
  }

  String get displayGroupName {
    final lang = StorageService.instance.getLanguageCode();
    if (lang == 'en' && groupNameEn != null && groupNameEn!.isNotEmpty) {
      return groupNameEn!;
    }
    return groupName;
  }
}

class MenuItem {
  final int id;
  final String title;
  final String? titleEn;
  final String category;
  final String? categoryEn;
  final double basePrice;
  final String description;
  final String? descriptionEn;
  final String image;
  final bool isFeatured;
  final List<OptionGroup> optionGroups;

  MenuItem({
    required this.id,
    required this.title,
    this.titleEn,
    required this.category,
    this.categoryEn,
    required this.basePrice,
    required this.description,
    this.descriptionEn,
    required this.image,
    this.isFeatured = false,
    required this.optionGroups,
  });

  factory MenuItem.fromJson(Map<String, dynamic> json) {
    // Check if category is an object and parse its nameEn
    String catAr = '';
    String? catEn;
    if (json['category'] is Map) {
      catAr = json['category']['name'] ?? '';
      catEn = json['category']['nameEn'];
    } else {
      catAr = json['category']?.toString() ?? '';
    }

    return MenuItem(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id'].toString()) ?? 0,
      title: json['title'] ?? '',
      titleEn: json['titleEn'],
      category: catAr,
      categoryEn: catEn,
      basePrice: double.tryParse(json['basePrice']?.toString() ?? '0') ?? 0.0,
      description: json['description'] ?? '',
      descriptionEn: json['descriptionEn'],
      image: json['image'] ?? '',
      isFeatured: json['isFeatured'] ?? false,
      optionGroups: json['optionGroups'] != null 
          ? List<OptionGroup>.from(json['optionGroups'].map((x) => OptionGroup.fromJson(x)))
          : [],
    );
  }

  String get displayTitle {
    final lang = StorageService.instance.getLanguageCode();
    if (lang == 'en' && titleEn != null && titleEn!.isNotEmpty) {
      return titleEn!;
    }
    return title;
  }

  String get displayDescription {
    final lang = StorageService.instance.getLanguageCode();
    if (lang == 'en' && descriptionEn != null && descriptionEn!.isNotEmpty) {
      return descriptionEn!;
    }
    return description;
  }

  String get displayCategory {
    final lang = StorageService.instance.getLanguageCode();
    if (lang == 'en' && categoryEn != null && categoryEn!.isNotEmpty) {
      return categoryEn!;
    }
    return category;
  }

  double get displayPrice {
    if (basePrice > 0) return basePrice;
    
    // If base price is 0, find the minimum price of all options in required groups
    double minOptionPrice = double.infinity;
    bool hasRequiredOptions = false;

    for (var group in optionGroups) {
      if (group.isRequired && group.options.isNotEmpty) {
        hasRequiredOptions = true;
        for (var opt in group.options) {
          if (opt.isAvailable && opt.price < minOptionPrice) {
            minOptionPrice = opt.price;
          }
        }
      }
    }

    return hasRequiredOptions && minOptionPrice != double.infinity ? minOptionPrice : basePrice;
  }

  bool get startsFrom {
    if (basePrice > 0) return false;
    for (var group in optionGroups) {
      if (group.isRequired && group.options.length > 1) return true;
    }
    return false;
  }
}

class Category {
  final int id;
  final String name;
  final String? nameEn;
  final String? description;
  final String? descriptionEn;
  final String? image;
  
  Category({
    required this.id, 
    required this.name,
    this.nameEn,
    this.description,
    this.descriptionEn,
    this.image,
  });
  
  factory Category.fromJson(Map<String, dynamic> json) {
    return Category(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id'].toString()) ?? 0,
      name: json['name'] ?? '',
      nameEn: json['nameEn'],
      description: json['description'],
      descriptionEn: json['descriptionEn'],
      image: json['image'],
    );
  }

  String get displayName {
    final lang = StorageService.instance.getLanguageCode();
    if (lang == 'en' && nameEn != null && nameEn!.isNotEmpty) {
      return nameEn!;
    }
    return name;
  }
}

class Review {
  final int id;
  final String customerName;
  final int rating;
  final String comment;
  final String createdAt;

  Review({
    required this.id,
    required this.customerName,
    required this.rating,
    required this.comment,
    required this.createdAt,
  });

  factory Review.fromJson(Map<String, dynamic> json) {
    return Review(
      id: json['id'] ?? 0,
      customerName: json['customerName'] ?? 'Customer',
      rating: json['rating'] ?? 5,
      comment: json['comment'] ?? '',
      createdAt: json['createdAt'] ?? '',
    );
  }
}
