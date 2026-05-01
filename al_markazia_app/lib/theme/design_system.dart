import 'package:flutter/material.dart';

/**
 * 🎨 Al-Markazia Design System (Premium Tokens)
 * Purpose: Centralize visual excellence and ensure consistent UI across the app.
 */
class DesignSystem {
  // --- 🌈 Colors (Luxury Palette) ---
  static const Color primary = Color(0xFFDCA965);
  static const Color primaryDark = Color(0xFFB8860B);
  static const Color accent = Color(0xFFE5C185);
  
  static const Color backgroundLight = Color(0xFFFDFBF7);
  static const Color backgroundDark = Color(0xFF101010);
  
  static const Color error = Color(0xFFE53935);
  static const Color success = Color(0xFF43A047);
  static const Color warning = Color(0xFFFFB300);

  // --- 🎭 Gradients (The "Premium" Factor) ---
  static const LinearGradient luxuryGradient = LinearGradient(
    colors: [primary, primaryDark],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static LinearGradient overlayGradient(Color base) => LinearGradient(
    colors: [base.withOpacity(0.8), base.withOpacity(0.0)],
    begin: Alignment.bottomCenter,
    end: Alignment.topCenter,
  );

  // --- 📏 Spacing & Radius ---
  static const double spacingXS = 4.0;
  static const double spacingS = 8.0;
  static const double spacingM = 16.0;
  static const double spacingL = 24.0;
  static const double spacingXL = 32.0;

  static const double radiusS = 8.0;
  static const double radiusM = 16.0;
  static const double radiusL = 24.0;
  static const double radiusXL = 32.0;

  // --- 🌑 Shadows (Depth & Realism) ---
  static List<BoxShadow> softShadow(Color base) => [
    BoxShadow(
      color: base.withOpacity(0.05),
      blurRadius: 20,
      offset: const Offset(0, 10),
    ),
  ];

  static List<BoxShadow> hardShadow(Color base) => [
    BoxShadow(
      color: base.withOpacity(0.1),
      blurRadius: 30,
      offset: const Offset(0, 15),
    ),
  ];

  // --- 📝 Typography Helper ---
  static TextStyle heading(BuildContext context, {Color? color}) => TextStyle(
    fontSize: 24,
    fontWeight: FontWeight.w900,
    fontFamily: 'Cairo',
    color: color ?? Theme.of(context).textTheme.titleLarge?.color,
  );

  static TextStyle body(BuildContext context, {Color? color}) => TextStyle(
    fontSize: 14,
    fontFamily: 'Cairo',
    color: color ?? Theme.of(context).textTheme.bodyMedium?.color,
  );
}
