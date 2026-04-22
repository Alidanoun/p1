import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:lottie/lottie.dart';
import '../models/order_model.dart';
import '../l10n/generated/app_localizations.dart';
import 'main_nav_screen.dart';

class OrderSuccessScreen extends StatelessWidget {
  final OrderModel order;
  
  const OrderSuccessScreen({Key? key, required this.order}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    final primaryColor = theme.primaryColor;
    final isDark = theme.brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF121212) : Colors.white,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Spacer(),
              
              // 🎉 Celebrate with Animation
              Center(
                child: Container(
                  width: 200,
                  height: 200,
                  decoration: BoxDecoration(
                    color: primaryColor.withOpacity(0.1),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(Icons.check_circle_rounded, size: 100, color: primaryColor),
                ).animate()
                 .scale(duration: 600.ms, curve: Curves.elasticOut)
                 .shimmer(delay: 600.ms, duration: 1.seconds),
              ),
              
              const SizedBox(height: 32),
              
              Text(
                l10n.orderConfirmedMsg,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900),
              ).animate().fadeIn(delay: 200.ms).moveY(begin: 10, end: 0),
              
              const SizedBox(height: 12),
              
              Text(
                '${l10n.orderIdLabel} ${order.orderNumber ?? order.orderId}',
                style: TextStyle(
                  fontSize: 16, 
                  color: primaryColor,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.1
                ),
              ).animate().fadeIn(delay: 400.ms),
              
              const SizedBox(height: 24),
              
              Text(
                l10n.brandSubtitle,
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey.withOpacity(0.8), fontSize: 14),
              ).animate().fadeIn(delay: 600.ms),
              
              const Spacer(),
              
              // 🚀 Actions
              SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton(
                  onPressed: () {
                    Navigator.of(context).pushAndRemoveUntil(
                      MaterialPageRoute(builder: (_) => const MainNavScreen(initialIndex: 3)), // 3 is Orders tab
                      (route) => false,
                    );
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: primaryColor,
                    foregroundColor: Colors.black,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    elevation: 0,
                  ),
                  child: Text(
                    l10n.myOrders,
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                ),
              ).animate().fadeIn(delay: 800.ms).scale(begin: const Offset(0.9, 0.9)),
              
              const SizedBox(height: 12),
              
              TextButton(
                onPressed: () {
                  Navigator.of(context).pushAndRemoveUntil(
                    MaterialPageRoute(builder: (_) => const MainNavScreen(initialIndex: 0)), // Home
                    (route) => false,
                  );
                },
                child: Text(
                  l10n.backToHome,
                  style: TextStyle(color: isDark ? Colors.white70 : Colors.black54, fontWeight: FontWeight.bold),
                ),
              ).animate().fadeIn(delay: 1.seconds),
              
              const SizedBox(height: 20),
            ],
          ),
        ),
      ),
    );
  }
}
