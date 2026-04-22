import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'home_screen.dart';
import 'orders_screen.dart';
import 'account_screen.dart';
import 'favorites_screen.dart';
import 'cart_screen.dart';

class MainNavScreen extends StatefulWidget {
  final int initialIndex;
  const MainNavScreen({Key? key, this.initialIndex = 0}) : super(key: key);

  @override
  State<MainNavScreen> createState() => _MainNavScreenState();
}

class _MainNavScreenState extends State<MainNavScreen> {
  late int _currentIndex;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex;
  }

  final List<Widget> _pages = [
    const HomeScreen(),        // 0
    const FavoritesScreen(),   // 1
    const SizedBox.shrink(),   // 2 (Placeholder for FAB)
    const OrdersScreen(),      // 3
    const AccountScreen(),     // 4
  ];

  void _onItemTapped(int index) {
    if (index == 2) return; // FAB handles its own tap
    setState(() {
      _currentIndex = index;
    });
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final primaryColor = Theme.of(context).primaryColor;
    final navBgColor = isDark ? const Color(0xFF151515) : Colors.white;
    // High contrast for professional look
    final unselectedColor = isDark ? Colors.white : Colors.black;

    return Scaffold(
      extendBody: true, // Allows background to flow under nav bar area if transparent
      body: IndexedStack(
        index: _currentIndex,
        children: _pages,
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      floatingActionButton: Container(
        height: 64,
        width: 64,
        margin: const EdgeInsets.only(top: 24),
        child: FloatingActionButton(
          onPressed: () {
            Navigator.push(context, MaterialPageRoute(builder: (_) => const CartScreen()));
          },
          backgroundColor: primaryColor,
          elevation: 8,
          highlightElevation: 12,
          shape: const CircleBorder(),
          child: const Icon(
            Icons.shopping_bag_rounded, // Cart instead of Plus
            color: Colors.white,
            size: 28,
          ),
        ).animate(onPlay: (c) => c.repeat(reverse: true)).scaleXY(end: 1.05, duration: 2.seconds),
      ),
      bottomNavigationBar: Container(
        height: 70,
        decoration: BoxDecoration(
          color: navBgColor,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(isDark ? 0.3 : 0.05),
              blurRadius: 20,
              offset: const Offset(0, -5),
            )
          ],
        ),
        child: ClipRRect(
          borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildNavItem(icon: Icons.home_rounded, index: 0, unselectedColor: unselectedColor, primaryColor: primaryColor),
              _buildNavItem(icon: Icons.favorite_border_rounded, activeIcon: Icons.favorite_rounded, index: 1, unselectedColor: unselectedColor, primaryColor: primaryColor),
              const SizedBox(width: 48), // Space for FAB
              _buildNavItem(icon: Icons.receipt_long_outlined, activeIcon: Icons.receipt_long_rounded, index: 3, unselectedColor: unselectedColor, primaryColor: primaryColor),
              _buildNavItem(icon: Icons.person_outline_rounded, activeIcon: Icons.person_rounded, index: 4, unselectedColor: unselectedColor, primaryColor: primaryColor),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildNavItem({required IconData icon, IconData? activeIcon, required int index, required Color unselectedColor, required Color primaryColor}) {
    final isSelected = _currentIndex == index;
    return GestureDetector(
      onTap: () => _onItemTapped(index),
      behavior: HitTestBehavior.opaque,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                isSelected ? (activeIcon ?? icon) : icon,
                color: isSelected ? primaryColor : unselectedColor,
                size: isSelected ? 28 : 24,
              ),
              if (isSelected)
                Container(
                  margin: const EdgeInsets.only(top: 4),
                  height: 4,
                  width: 4,
                  decoration: BoxDecoration(
                    color: primaryColor,
                    shape: BoxShape.circle,
                  ),
                ).animate().scale(duration: 200.ms),
            ],
          ),
        ),
      ),
    );
  }
}

