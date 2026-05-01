import 'package:flutter/material.dart';
import 'design_system.dart';

class AppTheme {
  static const Color primaryColor = DesignSystem.primary;
  static const Color primaryDarkColor = DesignSystem.primaryDark;
  
  static const Color darkBackground = DesignSystem.backgroundDark;
  static const Color darkSurface = Color(0xFF1A1A1A); 
  
  static const Color lightBackground = DesignSystem.backgroundLight;
  static const Color lightSurface = Colors.white; 
  
  static const String fontFamily = 'Cairo'; 

  static ThemeData get lightTheme {
    return ThemeData(
      primaryColor: primaryColor,
      scaffoldBackgroundColor: lightBackground,
      colorScheme: const ColorScheme.light(
        primary: primaryColor,
        secondary: primaryDarkColor,
        background: lightBackground,
        surface: lightSurface,
        onBackground: Color(0xFF2C2C2C), // Dark charcoal text instead of harsh black
        onSurface: Color(0xFF2C2C2C),
      ),
      fontFamily: fontFamily,
      appBarTheme: const AppBarTheme(
        backgroundColor: lightBackground,
        elevation: 0,
        centerTitle: true,
        iconTheme: IconThemeData(color: Color(0xFF2C2C2C)),
        titleTextStyle: TextStyle(
          color: Color(0xFF2C2C2C),
          fontSize: 20,
          fontWeight: FontWeight.w800,
          fontFamily: fontFamily,
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: Colors.white,
        selectedItemColor: primaryColor,
        unselectedItemColor: Colors.grey,
        showSelectedLabels: true,
        showUnselectedLabels: true,
        selectedLabelStyle: TextStyle(fontWeight: FontWeight.w700, fontSize: 11, fontFamily: fontFamily),
        unselectedLabelStyle: TextStyle(fontSize: 11, fontFamily: fontFamily),
        type: BottomNavigationBarType.fixed,
        elevation: 20,
      ),
      textTheme: const TextTheme(
        bodyLarge: TextStyle(color: Color(0xFF2C2C2C), fontFamily: fontFamily),
        bodyMedium: TextStyle(color: Color(0xFF555555), fontFamily: fontFamily),
        titleLarge: TextStyle(color: Color(0xFF1A1A1A), fontWeight: FontWeight.w900, fontFamily: fontFamily),
        titleMedium: TextStyle(color: Color(0xFF1A1A1A), fontWeight: FontWeight.w800, fontFamily: fontFamily),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primaryColor,
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 24),
          textStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, fontFamily: fontFamily),
        ),
      ),
      cardTheme: CardThemeData(
        color: lightSurface,
        elevation: 0, 
        shadowColor: Colors.black.withOpacity(0.04),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24),
          side: BorderSide.none,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFFF5F3ED),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: primaryColor, width: 1.5),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
        hintStyle: const TextStyle(color: Colors.grey, fontFamily: fontFamily),
      ),
    );
  }

  static ThemeData get darkTheme {
    return ThemeData(
      primaryColor: primaryColor,
      scaffoldBackgroundColor: darkBackground,
      colorScheme: const ColorScheme.dark(
        primary: primaryColor,
        secondary: primaryDarkColor,
        background: darkBackground,
        surface: darkSurface,
      ),
      fontFamily: fontFamily,
      appBarTheme: const AppBarTheme(
        backgroundColor: darkBackground,
        elevation: 0,
        centerTitle: true,
        iconTheme: IconThemeData(color: Colors.white),
        titleTextStyle: TextStyle(
          color: Colors.white,
          fontSize: 20,
          fontWeight: FontWeight.w800,
          fontFamily: fontFamily,
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: Color(0xFF151515),
        selectedItemColor: primaryColor,
        unselectedItemColor: Colors.white54,
        showSelectedLabels: true,
        showUnselectedLabels: true,
        selectedLabelStyle: TextStyle(fontWeight: FontWeight.w700, fontSize: 11, fontFamily: fontFamily),
        unselectedLabelStyle: TextStyle(fontSize: 11, fontFamily: fontFamily),
        type: BottomNavigationBarType.fixed,
        elevation: 20,
      ),
      textTheme: const TextTheme(
        bodyLarge: TextStyle(color: Colors.white, fontFamily: fontFamily),
        bodyMedium: TextStyle(color: Colors.white70, fontFamily: fontFamily),
        titleLarge: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontFamily: fontFamily),
        titleMedium: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontFamily: fontFamily),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primaryColor,
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 24),
          textStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, fontFamily: fontFamily),
        ),
      ),
      cardTheme: CardThemeData(
        color: darkSurface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24),
          side: const BorderSide(color: Color(0xFF2A2A2A), width: 1),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: darkSurface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: primaryColor, width: 1.5),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
        hintStyle: const TextStyle(color: Colors.white30, fontFamily: fontFamily),
      ),
    );
  }
}
