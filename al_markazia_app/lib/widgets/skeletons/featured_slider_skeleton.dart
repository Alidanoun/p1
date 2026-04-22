import 'package:flutter/material.dart';
import 'app_shimmer.dart';

class FeaturedSliderSkeleton extends StatelessWidget {
  const FeaturedSliderSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return AppShimmer(
      child: Container(
        height: 220,
        margin: const EdgeInsets.symmetric(horizontal: 20),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(24),
          color: isDark ? const Color(0xFF1E1E1E) : Colors.grey.shade200,
        ),
      ),
    );
  }
}
