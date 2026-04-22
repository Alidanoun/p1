import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../services/storage_service.dart';
import 'auth_screen.dart';

class LanguageSelectionScreen extends StatelessWidget {
  const LanguageSelectionScreen({Key? key}) : super(key: key);

  void _selectLanguage(BuildContext context, String code) async {
    await StorageService.instance.setLanguage(code);
    if (context.mounted) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const AuthScreen()),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Container(
        width: double.infinity,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              Colors.black,
              Colors.grey.shade900,
            ],
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Logo or Icon
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.05),
                shape: BoxShape.circle,
              ),
              child: Image.asset(
                'assets/icon/logo.png',
                height: 120,
              ),
            ).animate().fadeIn(duration: 800.ms).scale(delay: 200.ms),

            const SizedBox(height: 40),

            const Text(
              'اختر لغة التطبيق\nChoose App Language',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white,
                fontSize: 22,
                fontWeight: FontWeight.bold,
                height: 1.5,
              ),
            ).animate().fadeIn(delay: 500.ms, duration: 800.ms),

            const SizedBox(height: 60),

            // Arabic Button
            _buildLanguageButton(
              context,
              label: 'العربية',
              subLabel: 'Arabic',
              onTap: () => _selectLanguage(context, 'ar'),
            ).animate().slideX(begin: -0.2, delay: 700.ms).fadeIn(),

            const SizedBox(height: 20),

            // English Button
            _buildLanguageButton(
              context,
              label: 'English',
              subLabel: 'انجليزي',
              onTap: () => _selectLanguage(context, 'en'),
            ).animate().slideX(begin: 0.2, delay: 900.ms).fadeIn(),
          ],
        ),
      ),
    );
  }

  Widget _buildLanguageButton(BuildContext context, {
    required String label,
    required String subLabel,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 250,
        padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 24),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.05),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: Colors.white.withOpacity(0.1)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.2),
              blurRadius: 10,
              offset: const Offset(0, 5),
            ),
          ],
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  subLabel,
                  style: TextStyle(
                    color: Colors.white.withOpacity(0.5),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
            const Icon(
              Icons.arrow_forward_ios,
              color: Colors.orangeAccent,
              size: 16,
            ),
          ],
        ),
      ),
    );
  }
}
