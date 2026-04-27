import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';
import '../models/cart_item.dart';
import '../features/cart/cart_controller.dart';
import '../features/auth/auth_controller.dart';
import '../widgets/custom_dialogs.dart';
import 'checkout_screen.dart';
import 'auth_screen.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../l10n/generated/app_localizations.dart';

class CartScreen extends StatefulWidget {
  const CartScreen({Key? key}) : super(key: key);

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {

  @override
  void initState() {
    super.initState();
  }

  Future<void> _clearCart() async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await showCustomConfirmDialog(
      context: context,
      title: l10n.clearCart,
      content: l10n.clearCartConfirm,
      isDestructive: true,
      confirmText: l10n.clearCart,
    );
    if (confirmed == true) {
      await context.read<CartController>().clearCart();
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bgColor = Theme.of(context).scaffoldBackgroundColor;
    final cart = context.watch<CartController>();

    if (cart.isEmpty) {
      return Scaffold(
        appBar: AppBar(
          title: Text(AppLocalizations.of(context)!.cartTitle),
          backgroundColor: bgColor,
        ),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.shopping_bag_outlined, size: 80, color: isDark ? Colors.white24 : Colors.grey.shade300),
              const SizedBox(height: 16),
              Text(AppLocalizations.of(context)!.emptyCart, style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: isDark ? Colors.white54 : Colors.grey)),
              const SizedBox(height: 32),
              ElevatedButton(
                onPressed: () => Navigator.pop(context),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Theme.of(context).primaryColor,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
                  padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 16),
                ),
                child: Text(AppLocalizations.of(context)!.addPlates, style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 16)),
              )
            ],
          ),
        ).animate().fadeIn(),
      );
    }

    return Scaffold(
      backgroundColor: bgColor,
      appBar: AppBar(
        title: Text(AppLocalizations.of(context)!.cartTitle, style: const TextStyle(fontWeight: FontWeight.w900)),
        backgroundColor: bgColor,
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_sweep, color: Colors.redAccent),
            onPressed: _clearCart,
          )
        ],
      ),
      body: Column(
        children: [
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 8.0),
            child: Row(
              children: [
                Text('${cart.itemCount} ${AppLocalizations.of(context)!.items}', style: TextStyle(color: isDark ? Colors.white54 : Colors.grey.shade600, fontWeight: FontWeight.bold)),
              ],
            ),
          ),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
              itemCount: cart.itemCount,
              itemBuilder: (context, index) {
                final item = cart.items[index];
                return _buildCartCard(item, index)
                    .animate(delay: (100 * index).ms)
                    .fade(duration: 400.ms)
                    .slideX(begin: 0.1, end: 0);
              },
            ),
          ),
          
          // Bottom Footer
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
            decoration: BoxDecoration(
              color: Theme.of(context).cardTheme.color,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(isDark ? 0.2 : 0.05),
                  blurRadius: 20,
                  offset: const Offset(0, -5),
                )
              ],
            ),
            child: SafeArea(
              top: false,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(AppLocalizations.of(context)!.totalPriceLabel, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
                      Text('${cart.totalPrice.toStringAsFixed(2)} ${AppLocalizations.of(context)!.currency}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
                    ],
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    height: 56,
                    child: ElevatedButton(
                      onPressed: () {
                        final auth = context.read<AuthController>();
                        if (!auth.isAuthenticated) {
                          final l10n = AppLocalizations.of(context)!;
                          showCustomConfirmDialog(
                            context: context,
                            title: l10n.loginRequired,
                            content: l10n.loginToOrderMessage,
                            confirmText: l10n.loginTab,
                          ).then((confirmed) {
                            if (confirmed == true && mounted) {
                              Navigator.push(context, MaterialPageRoute(builder: (_) => const AuthScreen()));
                            }
                          });
                          return;
                        }
                        Navigator.push(context, MaterialPageRoute(builder: (_) => const CheckoutScreen()));
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Theme.of(context).primaryColor,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
                        elevation: 0,
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(AppLocalizations.of(context)!.confirmOrder, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.black)),
                          const SizedBox(width: 8),
                          const Icon(Icons.arrow_forward_rounded, color: Colors.black),
                        ],
                      ),
                    ),
                  )
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCartCard(CartItem item, int index) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: isDark ? Colors.white10 : Colors.black.withOpacity(0.05)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            // Circular Image
            Container(
              width: 80, height: 80,
              decoration: BoxDecoration(
                color: Colors.grey.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(40),
                child: item.image.isNotEmpty
                    ? (item.image.startsWith('http')
                        ? CachedNetworkImage(
                            imageUrl: item.image,
                            fit: BoxFit.cover,
                            placeholder: (context, url) => const Center(child: CircularProgressIndicator(strokeWidth: 2)),
                            errorWidget: (context, url, error) => const Icon(Icons.broken_image_rounded, color: Colors.grey),
                          )
                        : Image.asset('assets/${item.image}', fit: BoxFit.cover))
                    : const Icon(Icons.fastfood, color: Colors.grey),
              ),
            ),
            const SizedBox(width: 16),
            
            // Details
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          item.displayTitle, 
                          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Container(
                        height: 36,
                        decoration: BoxDecoration(
                          color: isDark ? const Color(0xFF2A2A2A) : const Color(0xFFF5F5F5),
                          borderRadius: BorderRadius.circular(18),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            InkWell(
                              onTap: () => context.read<CartController>().updateQuantity(index, -1),
                              borderRadius: const BorderRadius.horizontal(left: Radius.circular(18)),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8), 
                                child: Icon(Icons.remove, size: 14, color: item.quantity > 1 ? Theme.of(context).iconTheme.color : Colors.grey)
                              ),
                            ),
                            Text('${item.quantity}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                            InkWell(
                              onTap: () => context.read<CartController>().updateQuantity(index, 1),
                              borderRadius: const BorderRadius.horizontal(right: Radius.circular(18)),
                              child: const Padding(
                                padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8), 
                                child: Icon(Icons.add, size: 14)
                              ),
                            ),
                          ],
                        ),
                      )
                    ],
                  )
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
