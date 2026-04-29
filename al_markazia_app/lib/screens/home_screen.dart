import 'dart:async';
import 'package:flutter/material.dart';
import '../models/menu_item.dart';
import '../models/restaurant_status.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';
import 'item_details.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../services/notification_service.dart';
import 'notifications_screen.dart';
import '../l10n/generated/app_localizations.dart';
import '../widgets/skeletons/item_card_skeleton.dart';
import '../widgets/skeletons/category_skeleton.dart';
import '../widgets/skeletons/featured_slider_skeleton.dart';
import '../utils/time_formatter.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import '../widgets/order_tracking_widget.dart';
import '../models/order_model.dart';
import 'orders_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({Key? key}) : super(key: key);

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final ApiService _apiService = ApiService();
  List<Category> _categories = [];
  List<MenuItem> _menuItems = [];
  
  String _activeCategory = ''; // Initialized in build
  bool _isLoading = true;
  String? _errorMessage;
  RestaurantStatus? _status;

  String _searchQuery = '';
  bool _isSearching = false;
  final TextEditingController _searchController = TextEditingController();
  List<MenuItem> _searchResults = [];
  bool _isSearchLoading = false;
  String _lastSearchQuery = '';
  Timer? _debounce;
  List<String> _recentSearches = [];
  Timer? _countdownTimer;
  bool _isSubscribed = false;
  OrderModel? _activeOrder;
  
  // Featured Slider Logic
  final PageController _featuredPageController = PageController();
  int _currentFeaturedIndex = 0;
  Timer? _featuredTimer;
  List<int> _favorites = [];

  @override
  void initState() {
    super.initState();
    _fetchData();
    NotificationService().addListener(_onNotifUpdate);
    StorageService.instance.addListener(_onStorageChange);
    _favorites = StorageService.instance.getFavorites();
    _recentSearches = StorageService.instance.getRecentSearches();
  }

  void _startFeaturedTimer() {
    _featuredTimer?.cancel();
    _featuredTimer = Timer.periodic(const Duration(seconds: 5), (timer) {
      if (_menuItems.isEmpty) return;
      final featuredCount = _menuItems.where((i) => i.isFeatured).take(5).length;
      if (featuredCount <= 1) return;

      if (mounted && _featuredPageController.hasClients) {
        _currentFeaturedIndex = (_currentFeaturedIndex + 1) % featuredCount;
        _featuredPageController.animateToPage(
          _currentFeaturedIndex,
          duration: const Duration(milliseconds: 800),
          curve: Curves.fastOutSlowIn,
        );
      }
    });
  }

  void _onNotifUpdate() {
    if (mounted) setState(() {});
  }
  
  void _onStorageChange() {
    if (mounted) {
      setState(() {
        _favorites = StorageService.instance.getFavorites();
        _recentSearches = StorageService.instance.getRecentSearches();
      });
    }
  }

  @override
  void dispose() {
    _featuredTimer?.cancel();
    _countdownTimer?.cancel();
    _debounce?.cancel();
    _searchController.dispose();
    _featuredPageController.dispose();
    NotificationService().removeListener(_onNotifUpdate);
    StorageService.instance.removeListener(_onStorageChange);
    super.dispose();
  }

  Future<void> _fetchData({bool silent = false}) async {
    try {
      if (!silent) {
        setState(() {
          _isLoading = true;
          _errorMessage = null;
        });
      }

      // ✨ Smart UI Polish: Add a tiny artificial delay for premium transition feel
      // This prevents the skeleton from "flickering" if the API is ultra-fast.
      if (!silent) await Future.delayed(const Duration(milliseconds: 350));

      final cats = await _apiService.fetchCategories(forceRefresh: silent);
      final items = await _apiService.fetchMenuItems(forceRefresh: silent);
      final status = await _apiService.fetchRestaurantStatus();
      final activeOrder = await _apiService.fetchActiveOrder();
      
      if (mounted) {
        setState(() {
          _categories = cats;
          _menuItems = items;
          _status = status;
          _activeOrder = activeOrder;
          _isLoading = false;
        });
        _startFeaturedTimer();
        _startCountdownTimer();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = e.toString();
        });
      }
    }
  }

  List<MenuItem> get _filteredItems {
    List<MenuItem> list = _menuItems;
    final allLabel = AppLocalizations.of(context)!.categoryAll;
    if (_activeCategory.isNotEmpty && _activeCategory != allLabel) {
      list = list.where((i) => i.category == _activeCategory || i.displayCategory == _activeCategory || (i.categoryEn == _activeCategory)).toList();
    }
    if (_searchQuery.isNotEmpty) {
      list = list.where((i) => i.displayTitle.toLowerCase().contains(_searchQuery.toLowerCase())).toList();
    }
    return list;
  }

  void _performSearch(String query) async {
    final sanitizedQuery = query.trim();
    if (sanitizedQuery.length < 2) {
      setState(() {
        _searchResults = [];
        _isSearchLoading = false;
        _searchQuery = sanitizedQuery;
      });
      return;
    }

    _lastSearchQuery = query;
    setState(() {
      _isSearchLoading = true;
      _searchQuery = sanitizedQuery;
      _errorMessage = null;
    });

    try {
      final results = await _apiService.searchItems(sanitizedQuery);
      
      // 🛡️ Race Condition Protection
      if (_lastSearchQuery != query) return;

      if (mounted) {
        setState(() {
          _searchResults = results;
          _isSearchLoading = false;
        });
        
        // Save to recent searches if results found
        if (results.isNotEmpty) {
          await StorageService.instance.addRecentSearch(sanitizedQuery);
        }
      }
    } catch (e) {
      if (_lastSearchQuery != query) return;
      if (mounted) {
        setState(() {
          _isSearchLoading = false;
          _errorMessage = e.toString();
        });
      }
    }
  }

  void _onSearchChanged(String query) {
    if (_debounce?.isActive ?? false) _debounce!.cancel();

    if (query.trim().length < 2) {
      if (mounted) {
        setState(() {
          _searchResults = [];
          _isSearchLoading = false;
          _searchQuery = query.trim();
        });
      }
      return;
    }

    // ⚡ Dynamic Debounce Logic
    final debounceDuration = query.length < 5 
        ? const Duration(milliseconds: 300) 
        : const Duration(milliseconds: 500);

    _debounce = Timer(debounceDuration, () {
      _performSearch(query);
    });
  }


  void _toggleSearch() {
    setState(() {
      _isSearching = !_isSearching;
      if (!_isSearching) {
        _clearSearch();
      }
    });
  }

  void _clearSearch() {
    _searchController.clear();
    setState(() {
      _searchQuery = '';
      _searchResults = [];
      _isSearchLoading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    // Force dark visual elements even if the app theme is weird (to match design)
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bgColor = Theme.of(context).scaffoldBackgroundColor;
    final primaryColor = Theme.of(context).primaryColor;

    return Scaffold(
      backgroundColor: bgColor,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top Section (Search Bar & Notifications) - Moved to sticky header later or keep minimal
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 300),
                child: _isSearching
                    ? Row(
                        key: const ValueKey('searchBar'),
                        children: [
                          Expanded(
                            child: Container(
                              height: 50,
                              decoration: BoxDecoration(
                                color: isDark ? Colors.white.withOpacity(0.05) : Colors.grey[100],
                                borderRadius: BorderRadius.circular(25),
                                border: Border.all(color: isDark ? Colors.white10 : Colors.transparent),
                              ),
                              child: TextField(
                                controller: _searchController,
                                autofocus: true,
                                onChanged: _onSearchChanged,
                                style: TextStyle(color: isDark ? Colors.white : Colors.black, fontSize: 16),
                                decoration: InputDecoration(
                                  hintText: AppLocalizations.of(context)!.searchPlaceholder,
                                  hintStyle: TextStyle(color: isDark ? Colors.white38 : Colors.black38),
                                  prefixIcon: const Icon(Icons.search_rounded, color: Colors.orange, size: 22),
                                  suffixIcon: _searchController.text.isNotEmpty
                                      ? IconButton(
                                          icon: const Icon(Icons.close_rounded, size: 20),
                                          onPressed: _clearSearch,
                                        )
                                      : null,
                                  border: InputBorder.none,
                                  contentPadding: const EdgeInsets.symmetric(vertical: 13),
                                ),
                              ),
                            ).animate().fadeIn(duration: 300.ms).slideX(begin: 0.1, end: 0),
                          ),
                          const SizedBox(width: 12),
                          TextButton(
                            onPressed: _toggleSearch,
                            child: Text(
                              AppLocalizations.of(context)!.cancel,
                              style: const TextStyle(color: Colors.orange, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ],
                      )
                    : Row(
                        key: const ValueKey('welcomeHeader'),
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${AppLocalizations.of(context)!.welcome}،',
                                style: TextStyle(color: isDark ? Colors.white70 : Colors.black54, fontSize: 12),
                              ),
                              Text(
                                StorageService.instance.getCurrentUser()?['name'] ?? AppLocalizations.of(context)!.guest,
                                style: TextStyle(color: isDark ? Colors.white : Colors.black, fontSize: 18, fontWeight: FontWeight.w900),
                              ),
                            ],
                          ),
                          Row(
                            children: [
                              GestureDetector(
                                onTap: _toggleSearch,
                                child: Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    border: Border.all(color: isDark ? Colors.white12 : Colors.black12),
                                  ),
                                  child: Icon(Icons.search_rounded, color: isDark ? Colors.white : Colors.black),
                                ),
                              ),
                              const SizedBox(width: 8),
                              // Notification Bell
                              GestureDetector(
                                onTap: () {
                                  Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsScreen()));
                                },
                                child: Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    border: Border.all(color: isDark ? Colors.white12 : Colors.black12),
                                  ),
                                  child: Stack(
                                    alignment: Alignment.center,
                                    children: [
                                      Icon(
                                        NotificationService().unreadCount > 0 
                                            ? Icons.notifications_active_rounded 
                                            : Icons.notifications_none_rounded, 
                                        color: isDark ? Colors.white : Colors.black87, 
                                      ).animate(
                                        key: ValueKey(NotificationService().unreadCount),
                                        target: NotificationService().unreadCount > 0 ? 1 : 0
                                      ).shake(duration: 600.ms, hz: 4),
                                      
                                      if (NotificationService().unreadCount > 0)
                                        Positioned(
                                          top: 0,
                                          right: 0,
                                          child: Container(
                                            padding: const EdgeInsets.all(3),
                                            decoration: const BoxDecoration(color: Colors.redAccent, shape: BoxShape.circle),
                                            child: const SizedBox(width: 6, height: 6),
                                          ),
                                        ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          )
                        ],
                      ),
              ),
            ),
            
            // Grid Body Content (Scrollable part)
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 500),
                transitionBuilder: (child, animation) => FadeTransition(opacity: animation, child: child),
                child: _isSearching
                  ? _buildSearchResults(primaryColor, isDark)
                  : (_isLoading && _menuItems.isEmpty)
                    ? _buildHomeSkeleton(primaryColor, isLight: !isDark)
                    : RefreshIndicator(
                        key: const ValueKey('content'),
                        onRefresh: () => _fetchData(silent: true),
                        color: primaryColor,
                        child: SingleChildScrollView(
                          physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _buildStatusBanner(),
                              if (_menuItems.where((i) => i.isFeatured).isNotEmpty) ...[
                                _buildFeaturedSlider(primaryColor, isDark),
                                const SizedBox(height: 24),
                              ],
                              
                              SizedBox(
                                height: 48,
                                child: ListView(
                                  scrollDirection: Axis.horizontal,
                                  padding: const EdgeInsets.symmetric(horizontal: 16),
                                  physics: const BouncingScrollPhysics(),
                                  children: [
                                    _buildCategoryTab(AppLocalizations.of(context)!.categoryAll, primaryColor, isAll: true),
                                    ..._categories.map((c) => _buildCategoryTab(c.displayName, primaryColor)).toList(),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 16),
                              
                              const SizedBox(height: 12),
                              _buildBody(primaryColor),
                            ],
                          ),
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFeaturedSlider(Color primaryColor, bool isDark) {
    // 🛡️ Logic finalized in builder for atomic collapsing
    final featuredItems = _menuItems.where((i) => i.isFeatured).take(5).toList();
    if (featuredItems.isEmpty) return const SizedBox.shrink();

    return Column(
      children: [
        SizedBox(
          height: 220,
          child: PageView.builder(
            controller: _featuredPageController,
            onPageChanged: (index) {
              setState(() {
                _currentFeaturedIndex = index;
              });
            },
            itemCount: featuredItems.length,
            itemBuilder: (context, index) {
              final item = featuredItems[index];
              return Container(
                margin: const EdgeInsets.symmetric(horizontal: 20),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(24),
                  color: isDark ? const Color(0xFF1E1E1E) : Colors.grey.shade200,
                ),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: () {
                    setState(() => _activeCategory = item.category);
                    _openItemDetails(item);
                  },
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      if (item.image.isNotEmpty)
                        item.image.startsWith('http')
                          ? CachedNetworkImage(
                              imageUrl: item.image,
                              fit: BoxFit.cover,
                            )
                          : Image.asset('assets/${item.image}', fit: BoxFit.cover),
                      
                      DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.bottomCenter,
                            end: Alignment.topCenter,
                            colors: [
                              Colors.black.withOpacity(0.8),
                              Colors.transparent,
                            ],
                          ),
                        ),
                      ),
                      
                      Padding(
                        padding: const EdgeInsets.all(20.0),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.end,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: primaryColor.withOpacity(0.2),
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: primaryColor.withOpacity(0.5)),
                              ),
                              child: Text(
                                AppLocalizations.of(context)!.bestseller,
                                style: TextStyle(color: primaryColor, fontSize: 10, fontWeight: FontWeight.bold),
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              item.displayTitle,
                              style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              item.displayDescription,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(color: Colors.white70, fontSize: 12),
                            ),
                          ],
                        ),
                      ),
                      
                      Positioned(
                        bottom: 20,
                        left: 20,
                        child: Text(
                          '${item.displayPrice} ${AppLocalizations.of(context)!.currency}',
                          style: TextStyle(color: primaryColor, fontSize: 20, fontWeight: FontWeight.bold),
                        ),
                      )
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 12),
        // Dots indicator
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(featuredItems.length, (index) {
            final isActive = _currentFeaturedIndex == index;
            return AnimatedContainer(
              duration: const Duration(milliseconds: 300),
              margin: const EdgeInsets.symmetric(horizontal: 4),
              height: 6,
              width: isActive ? 20 : 6,
              decoration: BoxDecoration(
                color: isActive ? primaryColor : (isDark ? Colors.white24 : Colors.black26),
                borderRadius: BorderRadius.circular(3),
              ),
            );
          }),
        )
      ],
    );
  }

  Widget _buildBody(Color primaryColor) {
    if (_isLoading) {
      return Center(child: CircularProgressIndicator(color: primaryColor));
    }
    if (_errorMessage != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.wifi_off_rounded, size: 64, color: primaryColor.withOpacity(0.5)),
              const SizedBox(height: 16),
              Text(_errorMessage!, textAlign: TextAlign.center, style: const TextStyle(height: 1.5)),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: _fetchData,
                child: Text(AppLocalizations.of(context)!.retry),
              )
            ],
          ),
        ),
      );
    }

    if (_filteredItems.isEmpty) {
      return Center(child: Text(AppLocalizations.of(context)!.noDishesFound, style: const TextStyle(fontSize: 16)));
    }

    return GridView.builder(
      padding: const EdgeInsets.only(left: 20, right: 20, top: 0, bottom: 100), // padding bottom for bottom nav
      shrinkWrap: true, // Needed because it's inside a SingleChildScrollView now
      physics: const NeverScrollableScrollPhysics(), // Delegate scrolling to parent
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 0.75, // Taller cards
        crossAxisSpacing: 16,
        mainAxisSpacing: 16,
      ),
      itemCount: _filteredItems.length,
      itemBuilder: (context, index) {
        final item = _filteredItems[index];
        return _buildGridCard(item, primaryColor, index);
      },
    );
  }

  void _startCountdownTimer() {
    _countdownTimer?.cancel();
    if (_status == null || _status!.isOpen || _status!.nextOpenAt == null) return;

    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (mounted) {
        final now = DateTime.now();
        if (now.isAfter(_status!.nextOpenAt!)) {
          timer.cancel();
          _fetchData(); // Re-fetch status to open the restaurant in UI
          return;
        }
        setState(() {
          // Just trigger rebuild to update the countdown text
        });
      }
    });
  }

  Future<void> _handleSubscribe() async {
    if (_status?.nextOpenAt == null) return;
    
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null) throw Exception('TOKEN_NOT_FOUND');

      final success = await _apiService.subscribeToReopening(
        token, 
        _status!.nextOpenAt!.toIso8601String()
      );

      if (success && mounted) {
        setState(() => _isSubscribed = true);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(Localizations.localeOf(context).languageCode == 'ar' 
              ? 'سيتم إشعارك عند فتح المطعم ✅' 
              : 'You will be notified when we open ✅'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      debugPrint('Subscribe Error: $e');
    }
  }

  Widget _buildStatusBanner() {
    if (_status == null || _status!.isOpen) return const SizedBox.shrink();

    final isDark = Theme.of(context).brightness == Brightness.dark;
    final locale = Localizations.localeOf(context).languageCode;
    
    String iconLabel = '🔒';
    IconData icon = Icons.lock_outline_rounded;
    Color accentColor = Colors.orangeAccent;

    if (_status!.closureType == 'emergency') {
      iconLabel = '🚨';
      icon = Icons.error_outline_rounded;
      accentColor = Colors.redAccent;
    } else if (_status!.closureType == 'end_of_day') {
      iconLabel = '🌙';
      icon = Icons.nights_stay_outlined;
      accentColor = Colors.indigoAccent;
    }

    String timeText = '';
    if (_status!.nextOpenAt != null) {
      timeText = TimeFormatter.formatReopeningTime(_status!.nextOpenAt!, context);
    }

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      decoration: BoxDecoration(
        color: accentColor.withOpacity(0.1),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: accentColor.withOpacity(0.3)),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: accentColor, shape: BoxShape.circle),
                  child: Icon(icon, color: Colors.white, size: 20),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _status!.closureType == 'temporary' 
                          ? (locale == 'ar' ? 'المطعم مغلق مؤقتاً' : 'Temporarily Closed')
                          : (_status!.closureType == 'end_of_day' 
                              ? (locale == 'ar' ? 'انتهى دوام اليوم' : 'Closed for Today')
                              : (locale == 'ar' ? 'نعتذر، المطعم مغلق حالياً' : 'Restaurant Closed')),
                        style: TextStyle(fontWeight: FontWeight.w900, color: accentColor, fontSize: 15),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        timeText,
                        style: TextStyle(color: isDark ? Colors.white : Colors.black87, fontSize: 13, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
                if (_status!.closureType == 'temporary' && _status!.nextOpenAt != null)
                  Column(
                    children: [
                      Text(
                        TimeFormatter.formatCountdown(_status!.nextOpenAt!.difference(DateTime.now())),
                        style: TextStyle(color: accentColor, fontSize: 18, fontWeight: FontWeight.w900, fontFeatures: const [FontFeature.tabularFigures()]),
                      ),
                      Text(locale == 'ar' ? 'متبقي' : 'left', style: TextStyle(fontSize: 10, color: (isDark ? Colors.white : Colors.black).withOpacity(0.6))),
                    ],
                  ),
              ],
            ),
          ),
          
          if (!_isSubscribed && _status!.nextOpenAt != null)
            InkWell(
              onTap: _handleSubscribe,
              borderRadius: const BorderRadius.vertical(bottom: Radius.circular(20)),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: accentColor.withOpacity(0.1),
                  border: Border(top: BorderSide(color: accentColor.withOpacity(0.2))),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.notifications_active_outlined, size: 16, color: accentColor),
                    const SizedBox(width: 8),
                    Text(
                      locale == 'ar' ? 'ذكّرني عند الافتتاح 🔔' : 'Notify Me When Open 🔔',
                      style: TextStyle(color: accentColor, fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ),
            ),
          if (_isSubscribed)
             Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.green.withOpacity(0.1),
                  border: Border(top: BorderSide(color: Colors.green.withOpacity(0.2))),
                  borderRadius: const BorderRadius.vertical(bottom: Radius.circular(20)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.check_circle_outline, size: 16, color: Colors.green),
                    const SizedBox(width: 8),
                    Text(
                      locale == 'ar' ? 'سيتم إشعارك فور الافتتاح ✅' : 'We will notify you soon ✅',
                      style: const TextStyle(color: Colors.green, fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ),
        ],
      ),
    ).animate().fadeIn(duration: 500.ms).slideY(begin: 0.2, end: 0, curve: Curves.easeOutBack);
  }

  Widget _buildCategoryTab(String title, Color primaryColor, {bool isAll = false}) {
    final isActive = isAll 
        ? (_activeCategory.isEmpty || _activeCategory == AppLocalizations.of(context)!.categoryAll)
        : _activeCategory == title;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    final textColor = isActive 
        ? primaryColor 
        : (isDark ? Colors.white : Colors.black);
    
    return GestureDetector(
      onTap: () => setState(() => _activeCategory = isAll ? AppLocalizations.of(context)!.categoryAll : title),
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        alignment: Alignment.center,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              title,
              style: TextStyle(
                color: textColor,
                fontSize: 16,
                fontWeight: isActive ? FontWeight.w800 : FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            // Gold underline dot/line
            AnimatedContainer(
              duration: const Duration(milliseconds: 300),
              height: 3,
              width: isActive ? 24 : 0,
              decoration: BoxDecoration(
                color: primaryColor,
                borderRadius: BorderRadius.circular(2),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildGridCard(MenuItem item, Color primaryColor, int index) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final cardBgColor = isDark ? const Color(0xFF1E1E1E) : Colors.white; // Soft dark gray for card
    
    // Simulate the premium card layout from the reference image
    return Container(
      decoration: BoxDecoration(
        color: cardBgColor,
        borderRadius: BorderRadius.circular(32),
        // Subtly lighter border or shadow for depth
        border: isDark ? Border.all(color: Colors.white.withOpacity(0.05)) : null,
        boxShadow: isDark ? null : [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 15,
            offset: const Offset(0, 5),
          )
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(32),
          onTap: () => _openItemDetails(item),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(32),
            child: Stack(
            fit: StackFit.expand,
            children: [
              // Background Image (Full bleed or large center)
              if (item.image.isNotEmpty)
                item.image.startsWith('http') 
                  ? CachedNetworkImage(
                      imageUrl: item.image,
                      fit: BoxFit.cover,
                      placeholder: (context, url) => Container(
                        color: isDark ? Colors.white.withOpacity(0.05) : Colors.black.withOpacity(0.05),
                        child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
                      ),
                      errorWidget: (context, url, error) => const Center(child: Icon(Icons.broken_image_rounded, size: 40, color: Colors.grey)),
                    )
                  : DecoratedBox(
                      decoration: BoxDecoration(
                        image: DecorationImage(
                          image: AssetImage('assets/${item.image}'),
                          fit: BoxFit.cover,
                          alignment: Alignment.center,
                        ),
                      ),
                    )
              else 
                Center(
                  child: Icon(Icons.restaurant, size: 48, color: isDark ? Colors.white24 : Colors.black12),
                ),
              
              // Gradient Overlay to ensure text legibility
              DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Colors.black.withOpacity(0.7),
                      Colors.transparent,
                      Colors.black.withOpacity(0.6),
                    ],
                    stops: const [0.0, 0.4, 1.0],
                  ),
                ),
              ),
              
              // Content
              Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    // Top Section: Title & Favorite Button
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                item.displayTitle,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 16,
                                  fontWeight: FontWeight.w900,
                                  height: 1.2,
                                  letterSpacing: 0.5,
                                ),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              if (item.displayDescription.isNotEmpty) ...[
                                const SizedBox(height: 4),
                                Text(
                                  item.displayDescription,
                                  style: TextStyle(
                                    color: Colors.white.withOpacity(0.7),
                                    fontSize: 11,
                                    fontWeight: FontWeight.w500,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ]
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        ListenableBuilder(
                          listenable: StorageService.instance,
                          builder: (context, _) {
                            final isFav = StorageService.instance.getFavorites().contains(item.id);
                            return GestureDetector(
                              onTap: () => StorageService.instance.toggleFavorite(item.id),
                              child: Container(
                                padding: const EdgeInsets.all(6),
                                decoration: BoxDecoration(
                                  color: Colors.black.withOpacity(0.3),
                                  shape: BoxShape.circle,
                                ),
                                child: Icon(
                                  isFav ? Icons.favorite_rounded : Icons.favorite_outline_rounded, 
                                  color: isFav ? Colors.redAccent : Colors.white,
                                  size: 20,
                                ),
                              ),
                            );
                          },
                        ),
                      ],
                    ),
                    
                    // Bottom Section (Price & Button)
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (item.startsFrom)
                              Text(AppLocalizations.of(context)!.startingFrom, style: const TextStyle(color: Colors.white60, fontSize: 10, fontWeight: FontWeight.bold)),
                            Text(
                              '${item.displayPrice.toStringAsFixed(item.displayPrice % 1 == 0 ? 0 : 2)} ${AppLocalizations.of(context)!.currency}',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 13,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ],
                        ),
                        // Small Golden Button
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: primaryColor,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.add, 
                            color: Colors.black,
                            size: 20,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
      ).animate().fade(delay: (index * 40).ms, duration: 300.ms).slideY(begin: 0.1, end: 0, curve: Curves.easeOutCubic),
    );
  }

  Widget _buildHomeSkeleton(Color primaryColor, {required bool isLight}) {
    return SingleChildScrollView(
      key: const ValueKey('skeleton'),
      physics: const NeverScrollableScrollPhysics(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 1. Featured Skeleton
          const FeaturedSliderSkeleton(),
          
          const SizedBox(height: 24),
          
          // 2. Category Skeleton Row
          SizedBox(
            height: 48,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: 5,
              itemBuilder: (_, __) => const CategorySkeleton(),
            ),
          ),
          
          const SizedBox(height: 16),
          
          // 3. Grid Skeleton
          GridView.builder(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              childAspectRatio: 0.75,
              crossAxisSpacing: 16,
              mainAxisSpacing: 16,
            ),
            itemCount: 6,
            itemBuilder: (_, __) => const ItemCardSkeleton(),
          ),
        ],
      ),
    );
  }

  void _openItemDetails(MenuItem item) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => ItemDetailsSheet(item: item, status: _status),
    );
  }

  Widget _buildSearchResults(Color primaryColor, bool isDark) {
    final l10n = AppLocalizations.of(context)!;
    
    // 1. Initial State (Empty input) -> Recent Searches
    if (_searchController.text.isEmpty) {
      return _buildRecentSearches(isDark);
    }

    // 2. Loading State (Skeletons to prevent flicker)
    if (_isSearchLoading && _searchResults.isEmpty) {
       return _buildSearchSkeletons(primaryColor, isDark);
    }

    // 3. Error Case
    if (_errorMessage != null) {
      return _buildCenterMessage(Icons.error_outline, _errorMessage!, primaryColor);
    }

    // 4. Empty Result Case (Try discovery suggestions)
    if (_searchResults.isEmpty && !_isSearchLoading) {
       return _buildDiscoveryState(primaryColor, isDark);
    }

    // 5. Result Grid
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Text(
            '${l10n.searchResults} (${_searchResults.length})',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
          ),
        ),
        Expanded(
          child: GridView.builder(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            physics: const BouncingScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              childAspectRatio: 0.75,
              crossAxisSpacing: 16,
              mainAxisSpacing: 16,
            ),
            itemCount: _searchResults.length,
            itemBuilder: (context, index) {
              return _buildGridCard(_searchResults[index], primaryColor, index);
            },
          ),
        ),
      ],
    );
  }

  Widget _buildRecentSearches(bool isDark) {
    if (_recentSearches.isEmpty) {
      return _buildDiscoveryState(Theme.of(context).primaryColor, isDark);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Text(
            AppLocalizations.of(context)!.recentSearches,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
          ),
        ),
        ..._recentSearches.map((query) => ListTile(
          leading: const Icon(Icons.history_rounded, size: 20, color: Colors.grey),
          title: Text(query, style: const TextStyle(fontSize: 15)),
          onTap: () {
            _searchController.text = query;
            _performSearch(query);
          },
        )).toList(),
      ],
    );
  }

  Widget _buildDiscoveryState(Color primaryColor, bool isDark) {
    final suggestions = ['برجر', 'بيتزا', 'مشوي', 'وجبات', 'شاورما'];
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 40),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.search_off_rounded, size: 64, color: isDark ? Colors.white24 : Colors.black12),
          const SizedBox(height: 16),
          Text(
            AppLocalizations.of(context)!.noResultsFound,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          const Text(
            'جرّب كلمات أخرى للبحث أو اختر من الاقتراحات:',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey),
          ),
          const SizedBox(height: 24),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            alignment: WrapAlignment.center,
            children: suggestions.map((s) => ActionChip(
              label: Text(s),
              onPressed: () {
                _searchController.text = s;
                _performSearch(s);
              },
              backgroundColor: primaryColor.withOpacity(0.1),
              side: BorderSide(color: primaryColor.withOpacity(0.2)),
            )).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchSkeletons(Color primaryColor, bool isDark) {
    return GridView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 0.75,
        crossAxisSpacing: 16,
        mainAxisSpacing: 16,
      ),
      itemCount: 6,
      itemBuilder: (context, index) => const ItemCardSkeleton(),
    );
  }

  Widget _buildCenterMessage(IconData icon, String message, Color primaryColor) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 48, color: primaryColor.withOpacity(0.5)),
          const SizedBox(height: 16),
          Text(message, style: const TextStyle(color: Colors.grey)),
        ],
      ),
    );
  }
}
