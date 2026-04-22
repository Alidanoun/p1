import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../models/menu_item.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';
import 'item_details.dart';
import 'main_nav_screen.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../l10n/generated/app_localizations.dart';
import 'package:provider/provider.dart';
import '../features/cart/cart_controller.dart';
import '../widgets/custom_snackbar.dart';
import '../models/cart_item.dart';

class FavoritesScreen extends StatefulWidget {
  const FavoritesScreen({Key? key}) : super(key: key);

  @override
  State<FavoritesScreen> createState() => _FavoritesScreenState();
}

class _FavoritesScreenState extends State<FavoritesScreen> {
  final ApiService _apiService = ApiService();
  List<MenuItem> _allMenuItems = [];
  List<int> _favIds = [];

  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
    StorageService.instance.addListener(_updateFavs);
  }

  @override
  void dispose() {
    StorageService.instance.removeListener(_updateFavs);
    super.dispose();
  }

  void _updateFavs() {
    if (mounted) {
      setState(() {
        _favIds = StorageService.instance.getFavorites();
      });
    }
  }

  Future<void> _loadData() async {
    try {
      _favIds = StorageService.instance.getFavorites();
      final items = await _apiService.fetchMenuItems();
      setState(() {
        _allMenuItems = items;
        _isLoading = false;
      });
    } catch (_) {
      setState(() => _isLoading = false);
    }
  }

  List<MenuItem> get _favoriteItems {
    return _allMenuItems.where((item) => _favIds.contains(item.id)).toList();
  }

  void _openItemDetails(MenuItem item) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => ItemDetailsSheet(item: item),
    );
  }

  void _handleQuickAdd(MenuItem item) {
    final cart = context.read<CartController>();
    final l10n = AppLocalizations.of(context)!;

    // 🛡️ Guard: Check if mandatory options are required
    bool hasMandatoryOptions = item.optionGroups.any((group) => group.isRequired);

    if (hasMandatoryOptions) {
      // Must open sheet to let user choose
      _openItemDetails(item);
    } else {
      // Instant Add
      final cartItem = CartItem(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        productId: item.id,
        title: item.title,
        titleEn: item.titleEn,
        quantity: 1,
        unitPrice: item.basePrice,
        image: item.image,
      );
      cart.addItem(cartItem);
      showCustomSnackbar(context, l10n.addedToCart, isSuccess: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(title: Text('${l10n.favorites} ❤️')),
      body: _buildBody(l10n),
    );
  }

  Widget _buildBody(AppLocalizations l10n) {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    final items = _favoriteItems;

    if (items.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.favorite_border, size: 80, color: Colors.grey),
            const SizedBox(height: 16),
            Text(l10n.noFavorites, style: const TextStyle(fontSize: 20, color: Colors.grey)),
            const SizedBox(height: 8),
            Text(l10n.addFavoritePlates, style: const TextStyle(fontSize: 14, color: Colors.grey), textAlign: TextAlign.center),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () {
                Navigator.of(context).pushAndRemoveUntil(
                  MaterialPageRoute(builder: (_) => const MainNavScreen()),
                  (route) => false,
                );
              },
              child: Text(l10n.backToHome),
            )
          ],
        ),
      ).animate().fadeIn();
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final item = items[index];
        return Card(
          margin: const EdgeInsets.only(bottom: 16),
          child: InkWell(
            onTap: () => _openItemDetails(item),
            borderRadius: BorderRadius.circular(16),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Container(
                    width: 80,
                    height: 80,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      color: Colors.orange.withOpacity(0.1),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: item.image.isNotEmpty
                        ? CachedNetworkImage(
                            imageUrl: item.image,
                            fit: BoxFit.cover,
                            placeholder: (context, url) => const Center(child: CircularProgressIndicator(strokeWidth: 2)),
                            errorWidget: (context, url, error) => const Icon(Icons.broken_image, color: Colors.orange),
                          )
                        : const Icon(Icons.food_bank, color: Colors.orange, size: 40),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.displayTitle, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 8),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              item.basePrice > 0 
                                ? '${item.displayPrice} ${l10n.currency}' 
                                : l10n.asSelected,
                              style: TextStyle(color: Theme.of(context).primaryColor, fontWeight: FontWeight.bold),
                            ),
                            Row(
                              children: [
                                IconButton(
                                  icon: Icon(Icons.add_shopping_cart_rounded, color: Theme.of(context).primaryColor),
                                  onPressed: () => _handleQuickAdd(item),
                                ),
                                const SizedBox(width: 4),
                                IconButton(
                                  icon: const Icon(Icons.favorite, color: Colors.red),
                                  onPressed: () => StorageService.instance.toggleFavorite(item.id),
                                ),
                              ],
                            )
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ).animate(delay: (100 * index).ms).fadeIn().slideY(begin: 0.1, end: 0);
      },
    );
  }
}
