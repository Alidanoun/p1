import 'dart:async';
import 'package:flutter/material.dart';
import '../models/menu_item.dart';
import '../models/restaurant_status.dart';
import '../models/cart_item.dart';
import '../services/storage_service.dart';
import '../services/api_service.dart';
import 'package:provider/provider.dart';
import '../features/cart/cart_controller.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../widgets/custom_snackbar.dart';
import '../l10n/generated/app_localizations.dart';
import '../utils/time_formatter.dart';
// import 'package:share_plus/share_plus.dart';
import '../features/auth/auth_controller.dart';

class ItemDetailsSheet extends StatefulWidget {
  final MenuItem item;
  final RestaurantStatus? status;
  const ItemDetailsSheet({Key? key, required this.item, this.status}) : super(key: key);

  @override
  State<ItemDetailsSheet> createState() => _ItemDetailsSheetState();
}

class _ItemDetailsSheetState extends State<ItemDetailsSheet> {
  int quantity = 1;
  // Map of Group ID to List of Selected Options
  final Map<int, List<Option>> selectedOptions = {};
  final TextEditingController _noteController = TextEditingController();

  List<Review> _reviews = [];
  bool _isLoadingReviews = true;
  Timer? _countdownTimer;

  @override
  void initState() {
    super.initState();
    _fetchReviews();
    // Pre-select default options
    for (var group in widget.item.optionGroups) {
      final defaults = group.options.where((o) => o.isDefault && o.isAvailable).toList();
      if (defaults.isNotEmpty) {
        selectedOptions[group.id] = defaults;
      } else if (group.isRequired && group.options.isNotEmpty) {
        // If required but no default, select the first available one for SINGLE groups
        final firstAvailable = group.options.firstWhere((o) => o.isAvailable, orElse: () => group.options.first);
        selectedOptions[group.id] = [firstAvailable];
      }
    }
    _startCountdownTimer();
  }

  Future<void> _fetchReviews() async {
    try {
      final reviews = await ApiService().fetchItemReviews(widget.item.id);
      if (mounted) {
        setState(() {
          _reviews = reviews;
          _isLoadingReviews = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoadingReviews = false);
      }
    }
  }

  void _startCountdownTimer() {
    if (widget.status?.isOpen == false && widget.status?.nextOpenAt != null) {
      _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (mounted) {
          setState(() {
            if (DateTime.now().isAfter(widget.status!.nextOpenAt!)) {
              timer.cancel();
            }
          });
        }
      });
    }
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _noteController.dispose();
    super.dispose();
  }

  double get averageRating {
    if (_reviews.isEmpty) return 0.0;
    final total = _reviews.fold(0, (sum, item) => sum + item.rating);
    return total / _reviews.length;
  }

  double get unitPrice {
    double price = widget.item.basePrice;
    
    // Sum prices of all selected options
    selectedOptions.forEach((groupId, options) {
      for (var opt in options) {
        price += opt.price;
      }
    });

    return price;
  }

  double get totalPrice => unitPrice * quantity;

  void _addToCart() async {
    // Validate required groups
    final l10n = AppLocalizations.of(context)!;
    for (var group in widget.item.optionGroups) {
      if (group.isRequired && (selectedOptions[group.id] == null || selectedOptions[group.id]!.isEmpty)) {
        showCustomSnackbar(context, l10n.selectRequired(group.displayGroupName));
        return;
      }
    }

    String optionsTextAr = '';
    String optionsTextEn = '';
    List<int> optionIds = [];
    selectedOptions.forEach((groupId, options) {
      if (options.isNotEmpty) {
        final group = widget.item.optionGroups.firstWhere((g) => g.id == groupId);
        final optNamesAr = options.map((o) => o.name).join(', ');
        final optNamesEn = options.map((o) => o.nameEn ?? o.name).join(', ');
        optionsTextAr += '${group.groupName}: $optNamesAr | ';
        optionsTextEn += '${group.groupNameEn ?? group.groupName}: $optNamesEn | ';
        optionIds.addAll(options.map((o) => o.id));
      }
    });

    if (optionsTextAr.endsWith(' | ')) optionsTextAr = optionsTextAr.substring(0, optionsTextAr.length - 3);
    if (optionsTextEn.endsWith(' | ')) optionsTextEn = optionsTextEn.substring(0, optionsTextEn.length - 3);

    final cartItem = CartItem(
      id: '${widget.item.id}_${DateTime.now().millisecondsSinceEpoch}',
      productId: widget.item.id,
      title: widget.item.title,
      titleEn: widget.item.titleEn,
      image: widget.item.image,
      unitPrice: unitPrice,
      quantity: quantity,
      optionsText: optionsTextAr,
      optionsTextEn: optionsTextEn,
      optionIds: optionIds,
      note: _noteController.text.trim(),
    );

    await context.read<CartController>().addItem(cartItem);

    if (mounted) {
      Navigator.pop(context);
      showCustomSnackbar(context, l10n.addedToCart);
    }
  }

  String _statusButtonText() {
    if (widget.status?.nextOpenAt == null) return '';
    
    final diff = widget.status!.nextOpenAt!.difference(DateTime.now());
    if (widget.status!.closureType == 'temporary' && diff.inMinutes < 60) {
      return TimeFormatter.formatCountdown(diff);
    }
    
    return TimeFormatter.formatReopeningTime(widget.status!.nextOpenAt!, context);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bgColor = Theme.of(context).scaffoldBackgroundColor;
    
    return Container(
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
      ),
      height: MediaQuery.of(context).size.height * 0.92,
      child: Stack(
        children: [
          SingleChildScrollView(
            padding: const EdgeInsets.only(bottom: 150), // leave space for bottom bar
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Premium Hero Image
                Stack(
                  alignment: Alignment.topCenter,
                  children: [
                    Container(
                      height: 300,
                      decoration: BoxDecoration(
                        color: isDark ? const Color(0xFF1A1A1A) : const Color(0xFFF0F0F0),
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
                      ),
                      child: widget.item.image.isNotEmpty
                          ? ClipRRect(
                              borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
                              child: widget.item.image.startsWith('http')
                                  ? CachedNetworkImage(
                                      imageUrl: widget.item.image,
                                      fit: BoxFit.cover,
                                      placeholder: (context, url) => Center(
                                        child: CircularProgressIndicator(
                                          color: Theme.of(context).primaryColor.withOpacity(0.5),
                                          strokeWidth: 2,
                                        ),
                                      ),
                                      errorWidget: (context, url, error) => const Center(
                                        child: Icon(Icons.broken_image_rounded, size: 40, color: Colors.grey),
                                      ),
                                    )
                                  : Image.asset('assets/${widget.item.image}', fit: BoxFit.cover),
                            )
                          : const Center(child: Icon(Icons.fastfood, size: 80, color: Colors.grey)),
                    ),
                    // Gradient overlay to blend image into background smoothly
                    Container(
                      height: 300,
                      decoration: BoxDecoration(
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
                        gradient: LinearGradient(
                          begin: Alignment.bottomCenter,
                          end: Alignment.topCenter,
                          colors: [
                            bgColor,
                            bgColor.withOpacity(0.0),
                            Colors.black.withOpacity(0.4), // Dark top for close button visibility
                          ],
                        ),
                      ),
                    ),
                    // Close Button
                    Positioned(
                      top: 24,
                      right: 24,
                      child: GestureDetector(
                        onTap: () => Navigator.pop(context),
                        child: Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: Colors.black.withOpacity(0.3),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.close, color: Colors.white, size: 24),
                        ),
                      ),
                    ),
                    // Favorite Button
                    Positioned(
                      top: 24,
                      left: 24,
                      child: GestureDetector(
                        onTap: () => StorageService.instance.toggleFavorite(widget.item.id),
                        child: Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: Colors.black.withOpacity(0.3),
                            shape: BoxShape.circle,
                          ),
                          child: ListenableBuilder(
                            listenable: StorageService.instance,
                            builder: (context, _) {
                              final isFav = StorageService.instance.getFavorites().contains(widget.item.id);
                              return Icon(
                                isFav ? Icons.favorite_rounded : Icons.favorite_outline_rounded,
                                color: isFav ? Colors.redAccent : Colors.white,
                                size: 24,
                              );
                            }
                          ),
                        ),
                      ),
                    ),
                    // Share Button
                    Positioned(
                      top: 24,
                      left: 72,
                      child: GestureDetector(
                        onTap: () async {
                          // Allow share regardless of login, but only reward if logged in
                          showCustomSnackbar(context, 'تم نسخ رابط الوجبة! شاركها مع أصدقائك للحصول على النقاط.', isSuccess: true);
                          
                          if (mounted) {
                            final auth = context.read<AuthController>();
                            if (auth.isAuthenticated) {
                              try {
                                final response = await ApiService.instance.triggerSocialShareReward();
                                if (response != null && mounted) {
                                  if (response['rewarded'] == true) {
                                    showCustomSnackbar(context, response['message'] ?? 'تم إضافة نقاط المشاركة لمحفظتك!', isSuccess: true);
                                    auth.refreshProfile(); // Update points display
                                  }
                                }
                              } catch (e) {
                                debugPrint('Share reward failed: $e');
                              }
                            }
                          }
                        },
                        child: Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: Colors.black.withOpacity(0.3),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.share_rounded, color: Colors.white, size: 24),
                        ),
                      ),
                    ),
                  ],
                ),
                
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(widget.item.displayTitle, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 28)),
                      const SizedBox(height: 8),
                      // Info row (price / prep time)
                      Row(
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (widget.item.startsFrom)
                                Text(AppLocalizations.of(context)!.startingFrom, style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
                              Text("${widget.item.displayPrice.toStringAsFixed(widget.item.displayPrice % 1 == 0 ? 0 : 2)} ${AppLocalizations.of(context)!.currency}", style: TextStyle(color: Theme.of(context).primaryColor, fontWeight: FontWeight.bold, fontSize: 22)),
                            ],
                          ),
                          const Spacer(),
                          const Icon(Icons.star, color: Colors.orange, size: 18),
                          const SizedBox(width: 4),
                          Text(
                            _reviews.isEmpty ? AppLocalizations.of(context)!.newTag : averageRating.toStringAsFixed(1),
                            style: const TextStyle(fontWeight: FontWeight.bold)
                          ),
                          if (_reviews.isNotEmpty)
                            Text(" (${_reviews.length})", style: const TextStyle(color: Colors.grey, fontSize: 12)),
                          const SizedBox(width: 16),
                          const Icon(Icons.schedule, color: Colors.grey, size: 18),
                          const SizedBox(width: 4),
                          Text(l10n.prepTime, style: const TextStyle(color: Colors.grey)),
                        ],
                      ),
                      const SizedBox(height: 16),
                      if (widget.item.displayDescription.isNotEmpty)
                        Text(widget.item.displayDescription, style: TextStyle(color: Colors.grey.shade500, fontSize: 16, height: 1.5)),
                      
                      const SizedBox(height: 24),
                      const Divider(height: 1),
                      const SizedBox(height: 24),

                      // Dynamic Option Groups
                      ...widget.item.optionGroups.map((group) {
                         // Only show available options
                         final availableOptions = group.options.where((o) => o.isAvailable).toList();
                         if (availableOptions.isEmpty) return const SizedBox.shrink();

                         return _buildOptionGroup(
                           group: group,
                           options: availableOptions,
                           selected: selectedOptions[group.id] ?? [],
                           onSelect: (opt) {
                             setState(() {
                               if (group.type == 'SINGLE') {
                                 selectedOptions[group.id] = [opt];
                               } else {
                                 final current = selectedOptions[group.id] ?? [];
                                 if (current.contains(opt)) {
                                   current.remove(opt);
                                 } else {
                                   current.add(opt);
                                 }
                                 selectedOptions[group.id] = List.from(current);
                               }
                             });
                           },
                         );
                      }).toList(),
                        
                      const SizedBox(height: 16),
                      Text(l10n.notes, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _noteController,
                        style: TextStyle(color: Theme.of(context).textTheme.bodyLarge?.color),
                        decoration: InputDecoration(
                          hintText: l10n.notesHint,
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(16)),
                          filled: true,
                          fillColor: Theme.of(context).cardTheme.color,
                        ),
                        maxLines: 2,
                      ),
                      
                      const SizedBox(height: 24),
                      const Divider(height: 1),
                      const SizedBox(height: 24),

                      // Reviews Section
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(AppLocalizations.of(context)!.customerReviews, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
                          TextButton.icon(
                            onPressed: _openReviewDialog,
                icon: Icon(Icons.rate_review, size: 18, color: Theme.of(context).primaryColor),
                label: Text(l10n.addReview, style: TextStyle(color: Theme.of(context).primaryColor)),
              )
            ],
          ),
          const SizedBox(height: 16),
          if (_isLoadingReviews)
            const Center(child: CircularProgressIndicator())
          else if (_reviews.isEmpty)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Text(l10n.noReviews, style: const TextStyle(color: Colors.grey)),
              ),
            )
          else
            ..._reviews.take(5).map((review) => Container(
                          margin: const EdgeInsets.only(bottom: 12),
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: isDark ? const Color(0xFF2A2A2A) : Colors.grey.shade100,
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  CircleAvatar(
                                    radius: 16,
                                    backgroundColor: Theme.of(context).primaryColor.withOpacity(0.2),
                                    child: Icon(Icons.person, size: 16, color: Theme.of(context).primaryColor),
                                  ),
                                  const SizedBox(width: 8),
                                  Text(review.customerName, style: const TextStyle(fontWeight: FontWeight.bold)),
                                  const Spacer(),
                                  Row(
                                    children: List.generate(5, (index) => Icon(
                                      index < review.rating ? Icons.star : Icons.star_border,
                                      size: 14, color: Colors.orange,
                                    )),
                                  )
                                ],
                              ),
                              if (review.comment.isNotEmpty) ...[
                                const SizedBox(height: 8),
                                Text(review.comment, style: const TextStyle(fontSize: 13)),
                              ]
                            ],
                          ),
                        )).toList(),
                        
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Add Bar Bottom
          Positioned(
            left: 0, right: 0, bottom: 0,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
              decoration: BoxDecoration(
                color: Theme.of(context).cardTheme.color,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(isDark ? 0.3 : 0.05),
                    blurRadius: 20,
                    offset: const Offset(0, -5),
                  )
                ],
              ),
              child: SafeArea(
                top: false,
                child: Row(
                  children: [
                    // Modern Quantity Selector
                    Container(
                      height: 56,
                      decoration: BoxDecoration(
                        color: isDark ? const Color(0xFF2A2A2A) : const Color(0xFFF5F5F5),
                        borderRadius: BorderRadius.circular(28),
                      ),
                      child: Row(
                        children: [
                          IconButton(
                            icon: const Icon(Icons.remove, size: 20),
                            color: quantity > 1 ? Theme.of(context).iconTheme.color : Colors.grey,
                            onPressed: () { if (quantity > 1) setState(() => quantity--); }
                          ),
                          Text('$quantity', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                          IconButton(
                            icon: const Icon(Icons.add, size: 20),
                            onPressed: () => setState(() => quantity++)
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 16),
                    
                    // Add Checkout Button
                    Expanded(
                      child: SizedBox(
                        height: 56,
                        child: ElevatedButton(
                          onPressed: (widget.status?.isOpen == false) ? null : _addToCart,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: (widget.status?.isOpen == false) 
                              ? Colors.grey.withOpacity(0.3) 
                              : Theme.of(context).primaryColor,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
                            elevation: 0,
                            disabledBackgroundColor: isDark ? Colors.white10 : Colors.black12,
                          ),
                          child: Text(
                            (widget.status?.isOpen == false)
                              ? (Localizations.localeOf(context).languageCode == 'ar' 
                                  ? '🔒 مغلق الآن (${_statusButtonText()})' 
                                  : '🔒 Closed Now (${_statusButtonText()})')
                              : '${l10n.addToCart} (${totalPrice.toStringAsFixed(totalPrice % 1 == 0 ? 0 : 2)} ${l10n.currency})',
                            style: TextStyle(
                              fontSize: (widget.status?.isOpen == false) ? 12 : 16, 
                              fontWeight: FontWeight.bold, 
                              color: (widget.status?.isOpen == false) ? Colors.grey : Colors.black
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOptionGroup({
    required OptionGroup group,
    required List<Option> options,
    required List<Option> selected,
    required Function(Option) onSelect,
  }) {
    final l10n = AppLocalizations.of(context)!;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(group.displayGroupName, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
            if (group.isRequired) 
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(color: Colors.red.withOpacity(0.1), borderRadius: BorderRadius.circular(12)),
                child: Text(AppLocalizations.of(context)!.required, style: const TextStyle(color: Colors.red, fontSize: 12, fontWeight: FontWeight.bold)),
              )
            else
              Text(AppLocalizations.of(context)!.optional, style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold)),
          ],
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: options.map((opt) {
            final isSelected = selected.contains(opt);
            return ChoiceChip(
              label: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                child: Text('${opt.displayName} ${opt.price > 0 ? "(+${opt.price} ${l10n.currency})" : ""}'),
              ),
              selected: isSelected,
              onSelected: (_) => onSelect(opt),
              backgroundColor: isDark ? const Color(0xFF2A2A2A) : Colors.white,
              selectedColor: Theme.of(context).primaryColor.withOpacity(0.2),
              labelStyle: TextStyle(
                color: isSelected 
                  ? Theme.of(context).primaryColor 
                  : (isDark ? Colors.white70 : Colors.black87),
                fontWeight: isSelected ? FontWeight.bold : FontWeight.w600,
              ),
              shape: RoundedRectangleBorder(
                side: BorderSide(
                  color: isSelected 
                    ? Theme.of(context).primaryColor 
                    : (isDark ? Colors.transparent : Colors.grey.shade300)
                ),
                borderRadius: BorderRadius.circular(20),
              ),
              elevation: 0,
            );
          }).toList(),
        ),
        const SizedBox(height: 24),
      ],
    );
  }

  void _openReviewDialog() {
    final l10n = AppLocalizations.of(context)!;
    int _rating = 5;
    final _commentController = TextEditingController();
    bool _isSubmitting = false;

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) {
          final isDark = Theme.of(context).brightness == Brightness.dark;
          
          return AlertDialog(
            backgroundColor: isDark ? const Color(0xFF1E1E1E) : Colors.white,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
            title: Text(AppLocalizations.of(context)!.reviewDialogTitle, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.bold)),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(5, (index) {
                    return IconButton(
                      icon: Icon(
                        index < _rating ? Icons.star : Icons.star_border,
                        color: Colors.orange,
                        size: 36,
                      ),
                      onPressed: () => setDialogState(() => _rating = index + 1),
                    );
                  }),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _commentController,
                  decoration: InputDecoration(
                    hintText: AppLocalizations.of(context)!.reviewHint,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(16)),
                    filled: true,
                    fillColor: isDark ? const Color(0xFF2A2A2A) : Colors.grey.shade100,
                  ),
                  maxLines: 3,
                )
              ],
            ),
            actionsAlignment: MainAxisAlignment.spaceEvenly,
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: Text(AppLocalizations.of(context)!.cancel, style: const TextStyle(color: Colors.grey)),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: Theme.of(context).primaryColor,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                onPressed: _isSubmitting ? null : () async {
                  setDialogState(() => _isSubmitting = true);
                  final user = StorageService.instance.getCurrentUser();
                  final name = user?['name'] ?? AppLocalizations.of(context)!.guest;
                  try {
                    await ApiService().submitReview(
                      widget.item.id,
                      name,
                      _rating,
                      _commentController.text.trim(),
                    );
                    if (mounted) {
                      Navigator.pop(context);
                       showCustomSnackbar(context, AppLocalizations.of(context)!.reviewSuccess);
                    }
                  } catch (e) {
                    if (mounted) {
                      setDialogState(() => _isSubmitting = false);
                       showCustomSnackbar(context, '${AppLocalizations.of(context)!.supportError}: $e', isSuccess: false);
                    }
                  }
                },
                child: _isSubmitting 
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.black, strokeWidth: 2)) 
                   : Text(AppLocalizations.of(context)!.submitReview, style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
              )
            ],
          );
        }
      ),
    );
  }
}
