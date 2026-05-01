import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../models/loyalty_profile.dart';
import '../services/api_service.dart';
import '../theme/design_system.dart';
import '../widgets/feedback/ui_feedback.dart';

class LoyaltyHubScreen extends StatefulWidget {
  const LoyaltyHubScreen({Key? key}) : super(key: key);

  @override
  State<LoyaltyHubScreen> createState() => _LoyaltyHubScreenState();
}

class _LoyaltyHubScreenState extends State<LoyaltyHubScreen> {
  LoyaltyProfile? _profile;
  List<RewardItem> _rewards = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Map<String, dynamic>? _config;

  Future<void> _loadData() async {
    try {
      final profileData = await ApiService.instance.fetchLoyaltyProfile();
      final rewardsData = await ApiService.instance.fetchRewardsStore();
      final configData = await ApiService.instance.fetchSystemConfig();
      
      if (mounted) {
        setState(() {
          _profile = LoyaltyProfile.fromJson(profileData);
          _rewards = (rewardsData as List).map((r) => RewardItem.fromJson(r)).toList();
          _config = configData;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        UIFeedback.showError(context, 'فشل تحميل بيانات الولاء');
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('نادي الولاء', style: TextStyle(fontWeight: FontWeight.w900)),
        centerTitle: true,
      ),
      body: _isLoading 
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadData,
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildTierCard(),
                    const SizedBox(height: 32),
                    Text('المتجر والمكافآت', style: DesignSystem.heading(context).copyWith(fontSize: 20)),
                    const SizedBox(height: 16),
                    _buildRewardsGrid(),
                    const SizedBox(height: 32),
                    _buildEngagementSection(),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildTierCard() {
    if (_profile == null) return const SizedBox();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: DesignSystem.luxuryGradient,
        borderRadius: BorderRadius.circular(DesignSystem.radiusXL),
        boxShadow: DesignSystem.hardShadow(DesignSystem.primary),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('رصيد نقاطك', style: TextStyle(color: Colors.white70, fontSize: 14)),
                  Text('${_profile!.points}', style: const TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.w900)),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  _profile!.tier,
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('المستوى القادم: ${_profile!.nextTier}', style: const TextStyle(color: Colors.white, fontSize: 12)),
              Text('${_profile!.totalOrders} / ${_profile!.targetOrders} طلب', style: const TextStyle(color: Colors.white, fontSize: 12)),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: LinearProgressIndicator(
              value: _profile!.progress / 100,
              backgroundColor: Colors.white.withOpacity(0.1),
              valueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
              minHeight: 8,
            ),
          ).animate().shimmer(duration: 2.seconds),
        ],
      ),
    );
  }

  Widget _buildRewardsGrid() {
    if (_rewards.isEmpty) return const Center(child: Text('لا توجد مكافآت حالياً'));

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 16,
        mainAxisSpacing: 16,
        childAspectRatio: 0.8,
      ),
      itemCount: _rewards.length,
      itemBuilder: (context, index) {
        final reward = _rewards[index];
        final canAfford = _profile!.points >= reward.pointsCost;

        return Container(
          decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            borderRadius: BorderRadius.circular(DesignSystem.radiusM),
            boxShadow: DesignSystem.softShadow(Colors.black),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Container(
                  width: double.infinity,
                  decoration: BoxDecoration(
                    color: Colors.grey.withOpacity(0.1),
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(DesignSystem.radiusM)),
                  ),
                  child: reward.image != null 
                      ? Image.network(reward.image!, fit: BoxFit.cover)
                      : const Icon(Icons.redeem, size: 40, color: DesignSystem.primary),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(12.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(reward.title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                    const SizedBox(height: 4),
                    Text('${reward.pointsCost} نقطة', style: const TextStyle(color: DesignSystem.primary, fontWeight: FontWeight.w900, fontSize: 12)),
                    const SizedBox(height: 8),
                    SizedBox(
                      width: double.infinity,
                      height: 32,
                      child: ElevatedButton(
                        onPressed: canAfford ? () => _claimReward(reward) : null,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: DesignSystem.primary,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                          padding: EdgeInsets.zero,
                        ),
                        child: const Text('استبدال', style: TextStyle(fontSize: 12)),
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

  Widget _buildEngagementSection() {
    final referralPoints = _config?['loyalty']?['engagement']?['REFERRAL'] ?? 100;
    final sharePoints = _config?['loyalty']?['engagement']?['SOCIAL_SHARE'] ?? 20;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('احصل على نقاط إضافية', style: DesignSystem.heading(context).copyWith(fontSize: 18)),
        const SizedBox(height: 16),
        _buildEngagementTile(Icons.share_outlined, 'شارك التطبيق مع أصدقائك', '+$sharePoints نقطة'),
        _buildEngagementTile(Icons.person_add_outlined, 'ادعُ أصدقاءك للتسجيل', '+$referralPoints نقطة'),
      ],
    );
  }

  Widget _buildEngagementTile(IconData icon, String title, String points) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(DesignSystem.radiusM),
        border: Border.all(color: Colors.grey.withOpacity(0.1)),
      ),
      child: Row(
        children: [
          Icon(icon, color: DesignSystem.primary),
          const SizedBox(width: 16),
          Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w600))),
          Text(points, style: const TextStyle(color: DesignSystem.success, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Future<void> _claimReward(RewardItem reward) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('تأكيد الاستبدال'),
        content: Text('هل أنت متأكد من استبدال ${reward.pointsCost} نقطة بـ ${reward.title}؟'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('إلغاء')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('تأكيد')),
        ],
      ),
    );

    if (confirmed == true) {
      try {
        await ApiService.instance.claimReward(reward.id);
        UIFeedback.showSuccess(context, 'تم استبدال المكافأة بنجاح! راجع محفظة المكافآت.');
        _loadData();
      } catch (e) {
        UIFeedback.showError(context, e.toString().replaceAll('Exception: ', ''));
      }
    }
  }
}
