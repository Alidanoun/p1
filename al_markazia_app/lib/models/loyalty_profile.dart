class LoyaltyProfile {
  final int points;
  final String tier;
  final int totalOrders;
  final String nextTier;
  final int targetOrders;
  final int progress;

  LoyaltyProfile({
    required this.points,
    required this.tier,
    required this.totalOrders,
    required this.nextTier,
    required this.targetOrders,
    required this.progress,
  });

  factory LoyaltyProfile.fromJson(Map<String, dynamic> json) {
    return LoyaltyProfile(
      points: json['points'] ?? 0,
      tier: json['tier'] ?? 'SILVER',
      totalOrders: json['totalOrders'] ?? 0,
      nextTier: json['nextTier'] ?? 'GOLD',
      targetOrders: json['targetOrders'] ?? 10,
      progress: json['progress'] ?? 0,
    );
  }
}

class RewardItem {
  final int id;
  final String title;
  final String? description;
  final String? image;
  final int pointsCost;

  RewardItem({
    required this.id,
    required this.title,
    this.description,
    this.image,
    required this.pointsCost,
  });

  factory RewardItem.fromJson(Map<String, dynamic> json) {
    return RewardItem(
      id: json['id'],
      title: json['title'],
      description: json['description'],
      image: json['image'],
      pointsCost: json['pointsCost'],
    );
  }
}
