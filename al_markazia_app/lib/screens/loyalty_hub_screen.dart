import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../features/auth/auth_controller.dart';
import '../l10n/generated/app_localizations.dart';
import '../widgets/custom_snackbar.dart';
// import 'package:share_plus/share_plus.dart';
import '../services/api_service.dart';

class LoyaltyHubScreen extends StatelessWidget {
  const LoyaltyHubScreen({Key? key}) : super(key: key);

  void _shareApp(BuildContext context) {
    showCustomSnackbar(context, 'تم نسخ الرابط! شاركه مع أصدقائك.', isSuccess: true);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final user = auth.user;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bgColor = isDark ? const Color(0xFF101010) : const Color(0xFFF5F5F7);
    final cardColor = isDark ? const Color(0xFF1C1C1E) : Colors.white;
    final primaryColor = Theme.of(context).primaryColor;
    
    final int points = user?['points'] ?? 0;
    final String tier = user?['tier'] ?? 'SILVER';
    
    // Tier color mapping
    Color tierColor;
    String tierName;
    if (tier == 'GOLD') {
      tierColor = Colors.amber;
      tierName = 'ذهبي';
    } else if (tier == 'PLATINUM') {
      tierColor = Colors.blueGrey.shade300;
      tierName = 'بلاتيني';
    } else {
      tierColor = Colors.grey.shade400;
      tierName = 'فضي';
    }

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        backgroundColor: bgColor,
        appBar: AppBar(
          backgroundColor: bgColor,
          title: const Text('مركز المكافآت', style: TextStyle(fontWeight: FontWeight.w900)),
          centerTitle: true,
        ),
        body: Column(
          children: [
            // 🏆 User Status Card (Always visible at the top)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              child: Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [primaryColor.withOpacity(0.8), primaryColor],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: [
                    BoxShadow(
                      color: primaryColor.withOpacity(0.3),
                      blurRadius: 20,
                      offset: const Offset(0, 10),
                    )
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'رصيد النقاط',
                          style: TextStyle(color: Colors.white70, fontSize: 16, fontWeight: FontWeight.bold),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          decoration: BoxDecoration(
                            color: Colors.black26,
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: tierColor.withOpacity(0.5)),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.military_tech, color: tierColor, size: 16),
                              const SizedBox(width: 4),
                              Text(
                                tierName,
                                style: TextStyle(color: tierColor, fontWeight: FontWeight.bold, fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          '$points',
                          style: const TextStyle(color: Colors.white, fontSize: 48, fontWeight: FontWeight.w900, height: 1.0),
                        ),
                        const SizedBox(width: 8),
                        const Padding(
                          padding: EdgeInsets.only(bottom: 6),
                          child: Text(
                            'نقطة',
                            style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    const Text(
                      'استخدم نقاطك للحصول على خصومات ووجبات مجانية!',
                      style: TextStyle(color: Colors.white70, fontSize: 13),
                    ),
                  ],
                ),
              ),
            ),

            // TabBar
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              decoration: BoxDecoration(
                color: cardColor,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.grey.withOpacity(0.1)),
              ),
              child: TabBar(
                indicatorSize: TabBarIndicatorSize.tab,
                indicator: BoxDecoration(
                  color: primaryColor,
                  borderRadius: BorderRadius.circular(16),
                ),
                labelColor: Colors.white,
                unselectedLabelColor: Colors.grey,
                labelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                dividerColor: Colors.transparent,
                tabs: const [
                  Tab(text: 'المهام وكسب النقاط'),
                  Tab(text: 'متجر المكافآت'),
                ],
              ),
            ),

            // TabBarView
            Expanded(
              child: TabBarView(
                children: [
                  // Tab 1: Missions
                  ListView(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                    physics: const BouncingScrollPhysics(),
                    children: [
                      // 1. Review Mission
                      _buildMissionCard(
                        context,
                        icon: Icons.reviews_rounded,
                        iconColor: Colors.amber,
                        title: 'قيّم وجبتك',
                        pointsText: '+50 نقطة',
                        description: 'احصل على 50 نقطة عند تقييمك لأي طلب مستلم للمرة الأولى.',
                        actionText: 'اذهب للطلبات السابقة',
                        onTap: () {
                          Navigator.pop(context);
                          showCustomSnackbar(context, 'انتقل إلى شاشة "طلباتي" وقم بتقييم آخر طلب لك.', isSuccess: true);
                        },
                      ),
                      
                      const SizedBox(height: 16),

                      // 2. Share Mission
                      _buildMissionCard(
                        context,
                        icon: Icons.share_rounded,
                        iconColor: Colors.blueAccent,
                        title: 'شارك أطباقك المفضلة',
                        pointsText: '+20 نقطة',
                        description: 'شارك رابط أي وجبة تعجبك من قائمة الطعام مع أصدقائك. (مرة واحدة يومياً)',
                        actionText: 'تصفح قائمة الطعام',
                        onTap: () {
                          Navigator.pop(context);
                        },
                      ),
                      
                      const SizedBox(height: 16),

                      // 3. Invite Mission
                      _buildMissionCard(
                        context,
                        icon: Icons.group_add_rounded,
                        iconColor: Colors.purpleAccent,
                        title: 'ادعُ أصدقاءك',
                        pointsText: '+100 نقطة',
                        description: 'شارك رابط التطبيق مع أصدقائك، واكسب 100 نقطة عندما يكملون طلبهم الأول.',
                        actionText: 'مشاركة رابط التطبيق',
                        onTap: () => _shareApp(context),
                      ),
                    ],
                  ),

                  // Tab 2: Rewards Store
                  _RewardsStoreTab(userPoints: points),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMissionCard(
    BuildContext context, {
    required IconData icon,
    required Color iconColor,
    required String title,
    required String pointsText,
    required String description,
    required String actionText,
    required VoidCallback onTap,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final cardColor = isDark ? const Color(0xFF1C1C1E) : Colors.white;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: cardColor,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.grey.withOpacity(0.1)),
        boxShadow: [
          if (!isDark)
            BoxShadow(
              color: Colors.black.withOpacity(0.03),
              blurRadius: 10,
              offset: const Offset(0, 4),
            )
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: iconColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(icon, color: iconColor, size: 24),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.orange.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        pointsText,
                        style: const TextStyle(color: Colors.orange, fontSize: 12, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            description,
            style: const TextStyle(color: Colors.grey, fontSize: 13, height: 1.5),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: TextButton(
              onPressed: onTap,
              style: TextButton.styleFrom(
                backgroundColor: iconColor.withOpacity(0.1),
                foregroundColor: iconColor,
                padding: const EdgeInsets.symmetric(vertical: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: Text(actionText, style: const TextStyle(fontWeight: FontWeight.bold)),
            ),
          ),
        ],
      ),
    );
  }
}

class _RewardsStoreTab extends StatefulWidget {
  final int userPoints;
  const _RewardsStoreTab({Key? key, required this.userPoints}) : super(key: key);

  @override
  State<_RewardsStoreTab> createState() => _RewardsStoreTabState();
}

class _RewardsStoreTabState extends State<_RewardsStoreTab> {
  bool _isLoading = true;
  List<dynamic> _rewards = [];

  @override
  void initState() {
    super.initState();
    _fetchRewards();
  }

  Future<void> _fetchRewards() async {
    try {
      final data = await ApiService.instance.fetchRewardsStore();
      setState(() {
        _rewards = data;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _claimReward(dynamic reward) async {
    if (widget.userPoints < reward['pointsCost']) {
      showCustomSnackbar(context, 'رصيد نقاطك غير كافٍ', isSuccess: false);
      return;
    }

    try {
      showDialog(context: context, barrierDismissible: false, builder: (_) => const Center(child: CircularProgressIndicator()));
      
      final result = await ApiService.instance.claimReward(reward['id']);
      Navigator.pop(context); // close dialog
      
      if (result != null) {
        showCustomSnackbar(context, 'تم استبدال المكافأة بنجاح! كود: ${result['code']}', isSuccess: true);
        context.read<AuthController>().refreshProfile(); // Refresh points
      } else {
        showCustomSnackbar(context, 'حدث خطأ أثناء الاستبدال', isSuccess: false);
      }
    } catch (e) {
      Navigator.pop(context);
      showCustomSnackbar(context, e.toString().replaceAll('Exception: ', ''), isSuccess: false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) return const Center(child: CircularProgressIndicator());

    if (_rewards.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.card_giftcard, size: 64, color: Colors.grey.withOpacity(0.3)),
            const SizedBox(height: 16),
            Text('لا توجد مكافآت متاحة حالياً', style: TextStyle(color: Colors.grey.shade500, fontSize: 16)),
          ],
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(20),
      physics: const BouncingScrollPhysics(),
      itemCount: _rewards.length,
      separatorBuilder: (_, __) => const SizedBox(height: 16),
      itemBuilder: (context, index) {
        final reward = _rewards[index];
        final canAfford = widget.userPoints >= reward['pointsCost'];
        final isDark = Theme.of(context).brightness == Brightness.dark;
        final cardColor = isDark ? const Color(0xFF1C1C1E) : Colors.white;

        return Container(
          decoration: BoxDecoration(
            color: cardColor,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: Colors.grey.withOpacity(0.1)),
            boxShadow: [
              if (!isDark)
                BoxShadow(color: Colors.black.withOpacity(0.03), blurRadius: 10, offset: const Offset(0, 4))
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (reward['imageUrl'] != null && reward['imageUrl'].isNotEmpty)
                ClipRRect(
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
                  child: Image.network(
                    reward['imageUrl'],
                    height: 140,
                    width: double.infinity,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const SizedBox(),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(reward['title'] ?? '', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                          if (reward['description'] != null && reward['description'].isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Text(reward['description'], style: const TextStyle(fontSize: 12, color: Colors.grey)),
                            ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              const Icon(Icons.stars, size: 16, color: Colors.orange),
                              const SizedBox(width: 4),
                              Text(
                                '${reward['pointsCost']} نقطة',
                                style: const TextStyle(color: Colors.orange, fontWeight: FontWeight.bold, fontSize: 13),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    ElevatedButton(
                      onPressed: canAfford ? () => _claimReward(reward) : null,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Theme.of(context).primaryColor,
                        disabledBackgroundColor: Colors.grey.withOpacity(0.3),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                      ),
                      child: Text(
                        canAfford ? 'استبدل' : 'نقاطك لا تكفي',
                        style: TextStyle(fontWeight: FontWeight.bold, color: canAfford ? Colors.white : Colors.grey.shade600),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
