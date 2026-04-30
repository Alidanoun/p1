import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:firebase_messaging/firebase_messaging.dart';
import 'api_service.dart';
import 'session_service.dart';
import 'storage_service.dart';
import 'app_events.dart';
import '../main.dart';
import '../screens/notification_detail_screen.dart';
import 'package:flutter/services.dart';

/// 🛰️ Enterprise Notification Service V4 (Bulletproof Distributed Core)
/// Standardized for high-pressure event processing, persistent TTL, and backpressure control.
class NotificationService extends ChangeNotifier {
  static final NotificationService _instance = NotificationService._internal();
  factory NotificationService() => _instance;
  NotificationService._internal();

  IO.Socket? socket;
  final FirebaseMessaging _fcm = FirebaseMessaging.instance;
  final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();

  List<dynamic> notifications = [];
  int unreadCount = 0;
  
  // 📡 Managed Streams & Subscriptions
  final _orderUpdateController = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get orderUpdateStream => _orderUpdateController.stream;
  StreamSubscription<RemoteMessage>? _fcmSubscription;
  
  bool _isInitialized = false;
  bool _isInitializing = false;
  bool _isSyncing = false;
  
  Timer? _reconnectDebounce;
  Timer? _cacheCleanupTimer;
  Timer? _persistenceTimer; // 🛡️ Batch writer for storage
  bool _isCacheDirty = false;
  
  // 🛡️ Enterprise Guard Layers
  final Map<String, int> _dedupCache = {};
  final Set<String> _navigationLock = {}; 
  final Map<String, int> _uiBackpressureMap = {}; // 🛡️ Throttling for UI updates
  
  final int _ttlMs = 30000; 
  final int _uiThrottleMs = 1000; // 1s backpressure window

  // 🛡️ Fallback System (Watchdog for stuck orders)
  final Map<String, Timer> _statusWatchdogs = {};

  void startStatusWatchdog(String orderId) {
    _statusWatchdogs[orderId]?.cancel();
    _statusWatchdogs[orderId] = Timer(const Duration(seconds: 30), () async {
      print('🛰️ [Watchdog] Fallback triggered for order $orderId. Fetching fresh state...');
      try {
        final token = await SessionService.instance.accessToken;
        if (token == null) return;
        
        final response = await http.get(
          Uri.parse('${ApiService.baseUrl}/orders/$orderId'),
          headers: {'Authorization': 'Bearer $token'}
        ).timeout(const Duration(seconds: 10));

        if (response.statusCode == 200) {
          final data = json.decode(utf8.decode(response.bodyBytes));
          final orderData = data is Map && data.containsKey('data') ? data['data'] : data;
          _processIncomingEvent(orderData, fromSocket: false);
          print('✅ [Watchdog] Order $orderId state recovered via API.');
        }
      } catch (e) {
        print('❌ [Watchdog] Recovery failed: $e');
      } finally {
        _statusWatchdogs.remove(orderId);
      }
    });
  }

  // 🧪 V5 Feature Flags
  static const bool useV5Architecture = true;

  Future<void> init() async {
    if (_isInitialized || _isInitializing) {
      if (useV5Architecture && _isInitialized) {
        print('📡 [NotificationService V5] Already active, skipping init. Use reinitialize() for auth changes.');
      }
      return;
    }
    _isInitializing = true;

    try {
      final token = await SessionService.instance.accessToken;

      // 1. 🏗️ True Persistent Dedup Load (Time-Aware)
      _loadPersistentCache();
      
      // 2. [V5 Priority 2] Early Channel Registry
      await createNotificationChannel();

      await _localNotifications.initialize(
        const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(),
        ),
        onDidReceiveNotificationResponse: _onSelectNotification,
      );

      // 3. 🛡️ Socket Registry Guard
      _setupSocket(token);

      // 4. Cleanup Workers (Optimized for performance)
      _cacheCleanupTimer?.cancel();
      _cacheCleanupTimer = Timer.periodic(const Duration(minutes: 30), (_) => _cleanCache());
      
      // Batch writer for storage safety (Reduced frequency to prevent UI stutter)
      _persistenceTimer?.cancel();
      _persistenceTimer = Timer.periodic(const Duration(minutes: 2), (_) => _persistCacheToStorage());

      await fetchNotifications();
      await _setupFCM();
      
      _isInitialized = true;
      print('💎 [NotificationService V4] Bulletproof Core Active.');
    } catch (e) {
      print('❌ [NotificationService] Critical Failure: $e');
    } finally {
      _isInitializing = false;
    }
  }

  /// 🔄 [V5] Reactive Re-initialization (Phase 1)
  /// Safely re-runs initialization with new auth credentials.
  Future<void> reinitialize() async {
    if (!useV5Architecture) return;
    
    print('🔄 [NotificationService V5] Re-initializing for session update...');
    
    // 1. Teardown existing connections safely (Phase 2 logic inside _setupSocket)
    _isInitialized = false; 
    
    // 2. Re-run core initialization
    await init();
    
    notifyListeners();
  }

  void _setupSocket(String? token) {
    // Phase 2: Correct Socket Identity Binding
    if (socket != null) {
      print('🔌 [Socket V5] Tearing down existing connection...');
      socket?.off('order:created');
      socket?.off('order:updated');
      socket?.clearListeners();
      socket?.disconnect();
      socket?.dispose();
      socket = null;
    }

    if (token == null) {
      print('⚠️ [Socket V5] Skipping connection: No valid JWT token.');
      return;
    }

    print('🔌 [Socket V5] Connecting to ${ApiService.baseUrl} with JWT...');
    socket = IO.io(ApiService.baseUrl, <String, dynamic>{
      'transports': ['websocket'],
      'autoConnect': true,
      'auth': {'token': token},
    });

    socket?.onConnect((_) {
      _joinIdentityRoom();
      _debouncedSync();
    });

    socket?.on('order:created', (data) => _processIncomingEvent(data, fromSocket: true));
    socket?.on('order:updated', (data) => _processIncomingEvent(data, fromSocket: true));
  }

  /// 🧠 Central Event Router (Authority-Based + Backpressure)
  void _processIncomingEvent(dynamic data, {bool fromSocket = false, bool fromFCM = false}) {
    final id = _normalizeId(data);
    if (id == null) return;

    // 🛡️ Clear any active watchdog for this ID
    _statusWatchdogs[id]?.cancel();
    _statusWatchdogs.remove(id);

    final now = DateTime.now().millisecondsSinceEpoch;
    
    // 1. 🛡️ Replay Protection (Deduplication)
    if (_dedupCache.containsKey(id)) {
      final elapsed = now - _dedupCache[id]!;
      if (elapsed < _ttlMs && !fromFCM) return;
    }
    
    _dedupCache[id] = now;
    _isCacheDirty = true; 

    // 2. 🛡️ UI Backpressure Control
    final lastUiUpdate = _uiBackpressureMap[id] ?? 0;
    final uiElapsed = now - lastUiUpdate;

    if (data is Map<String, dynamic>) {
       if (uiElapsed > _uiThrottleMs) {
         _uiBackpressureMap[id] = now;
         _orderUpdateController.add(data);
       }
    }

    // 3. 🔔 Local Notification Display
    // FCM messages: always show local notification for foreground visibility
    // Socket messages: show local notification too (for real-time order alerts)
    if (data is Map && data['notification'] != null) {
      print('🔔 [NotificationService] Triggering Local Alert for: $id (FCM: $fromFCM, Socket: $fromSocket)');
      _showLocalNotification(data, normalizedId: id);
    } else if (fromSocket && data is Map<String, dynamic>) {
      // Socket data-only events: generate notification content from order data
      final status = data['status']?.toString() ?? '';
      final orderNumber = data['orderNumber']?.toString() ?? '';
      if (status.isNotEmpty && orderNumber.isNotEmpty) {
        final content = _generateStatusContent(status, orderNumber);
        final enriched = {
          ...data,
          'notification': content,
        };
        print('🔔 [Socket] Generating local alert for order $orderNumber status: $status');
        _showLocalNotification(enriched, normalizedId: id);
      }
    }
    
    // 4. Refresh notification list from server
    fetchNotifications();
    
    // 5. 🎁 Loyalty/Profile Sync: Refresh profile if order was delivered
    if (data is Map && data['status'] == 'delivered') {
      print('🎁 [NotificationService] Order delivered. Triggering profile sync...');
      AppEvents.emit(IdentityRefreshEvent());
    }
    
    notifyListeners();
  }

  /// 🏷️ Generate human-readable notification content from order status
  Map<String, String> _generateStatusContent(String status, String orderNumber) {
    final map = {
      'pending': {'title': 'طلب جديد 🔔', 'message': 'تم استلام طلبك رقم $orderNumber'},
      'preparing': {'title': 'جاري التحضير 👨‍🍳', 'message': 'طلبك رقم $orderNumber قيد التحضير الآن'},
      'ready': {'title': 'طلبك جاهز! ✅', 'message': 'طلبك رقم $orderNumber جاهز للاستلام أو التوصيل'},
      'in_route': {'title': 'في الطريق 🚗', 'message': 'طلبك رقم $orderNumber في الطريق إليك'},
      'delivered': {'title': 'تم التسليم 🥡', 'message': 'بالهناء والشفاء! نتمنى رؤيتك قريباً'},
      'cancelled': {'title': 'تم الإلغاء ❌', 'message': 'تم إلغاء طلبك رقم $orderNumber'},
    };
    return map[status] ?? {'title': 'تحديث الطلب', 'message': 'الطلب رقم $orderNumber أصبح $status'};
  }

  Future<void> _setupFCM() async {
    // 🛡️ Global Subscription Guard
    if (_fcmSubscription != null) await _fcmSubscription?.cancel();

    NotificationSettings settings = await _fcm.requestPermission(alert: true, badge: true, sound: true);

    if (settings.authorizationStatus == AuthorizationStatus.authorized) {
      String? token = await _fcm.getToken();
      if (token != null) await _updateTokenOnBackend(token);

      // Phase 3: Token Lifecycle Stabilization
      _fcm.onTokenRefresh.listen((newToken) async {
        print('📲 [FCM V5] Token refreshed, syncing with backend...');
        await _updateTokenOnBackend(newToken);
      });

      // [V5 Priority 1] Foreground Listener
      _fcmSubscription = FirebaseMessaging.onMessage.listen((RemoteMessage message) {
        _processIncomingEvent(
          {
            ...message.data,
            'notification': {
              'title': message.notification?.title,
              'message': message.notification?.body,
            }
          }, 
          fromFCM: true
        );
      });

      // [V5 Priority 4] Background Click Handler
      FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
        print('🖱️ [FCM V5] App opened via notification in background');
        _safeNavigate({
          ...message.data,
          'notification': {
            'title': message.notification?.title,
            'message': message.notification?.body,
          }
        });
      });

      // [V5 Priority 1] Killed State Handler
      final initialMessage = await _fcm.getInitialMessage();
      if (initialMessage != null) {
        print('🚀 [FCM V5] App launched from killed state via notification');
        _safeNavigate({
          ...initialMessage.data,
          'notification': {
            'title': initialMessage.notification?.title,
            'message': initialMessage.notification?.body,
          }
        });
      }

      // Topics Management
      if (SessionService.instance.isAdmin) {
        await _fcm.subscribeToTopic('staff_orders');
        await _fcm.unsubscribeFromTopic('all_users');
      } else {
        await _fcm.subscribeToTopic('all_users');
        await _fcm.unsubscribeFromTopic('staff_orders');
      }
    }
  }

  Future<void> _showLocalNotification(dynamic data, {required String normalizedId}) async {
    final int notificationId = normalizedId.hashCode.toUnsigned(31); 
    
    const androidDetails = AndroidNotificationDetails(
      'almarkazia_channel',
      'Al Markazia Notifications',
      importance: Importance.max,
      priority: Priority.high,
      showWhen: true,
      playSound: true,
      enableVibration: true,
      visibility: NotificationVisibility.public,
      category: AndroidNotificationCategory.message,
    );

    final title = data['notification']?['title']?.toString() ?? 'Al Markazia';
    final message = data['notification']?['message']?.toString() ?? 
                    data['notification']?['body']?.toString() ?? '';

    await _localNotifications.show(
      notificationId,
      title,
      message,
      const NotificationDetails(android: androidDetails),
      payload: json.encode(data),
    );
  }

  /// 🚪 Full Reset (Bulletproof Teardown)
  Future<void> reset() async {
    print('🧹 [NotificationService] Enterprise Reset Triggered...');
    _isInitialized = false;
    
    _cacheCleanupTimer?.cancel();
    _reconnectDebounce?.cancel();
    _persistenceTimer?.cancel();
    
    if (socket != null) {
      socket?.off('order:created');
      socket?.off('order:updated');
      socket?.clearListeners();
      socket?.disconnect();
      socket?.dispose();
      socket = null;
    }
    
    await _fcmSubscription?.cancel();
    _fcmSubscription = null;

    _dedupCache.clear();
    _navigationLock.clear();
    _uiBackpressureMap.clear();
    notifications.clear();
    unreadCount = 0;
    
    await StorageService.instance.remove('notif_dedup_cache_v4');
    notifyListeners();
  }

  // --- 🏛️ Enterprise Persistence Layer ---
  void _loadPersistentCache() {
    try {
      final jsonStr = StorageService.instance.getString('notif_dedup_cache_v4');
      if (jsonStr != null) {
        final Map<String, dynamic> rawMap = json.decode(jsonStr);
        final now = DateTime.now().millisecondsSinceEpoch;
        
        rawMap.forEach((key, timestamp) {
          if (now - (timestamp as int) < _ttlMs) {
            _dedupCache[key] = timestamp;
          }
        });
        print('🏛️ [Persistence] Loaded ${_dedupCache.length} active IDs from storage.');
      }
    } catch (e) {
      print('❌ [Persistence] Load Error: $e');
    }
  }

  void _persistCacheToStorage() {
    if (!_isCacheDirty) return;
    try {
      // Snapshot only non-expired IDs
      final now = DateTime.now().millisecondsSinceEpoch;
      final Map<String, int> snapshot = {};
      _dedupCache.forEach((key, timestamp) {
        if (now - timestamp < _ttlMs) {
          snapshot[key] = timestamp;
        }
      });
      
      StorageService.instance.setString('notif_dedup_cache_v4', json.encode(snapshot));
      _isCacheDirty = false;
      print('🏛️ [Persistence] Atomic Cache Sync Complete.');
    } catch (e) {
      print('❌ [Persistence] Write Error: $e');
    }
  }

  // --- Helpers ---
  String? _normalizeId(dynamic data) {
    if (data is! Map) return null;
    return data['notificationId']?.toString() ?? data['id']?.toString() ?? data['messageId']?.toString();
  }

  void _onSelectNotification(NotificationResponse response) {
    if (response.payload != null) {
      try {
        final data = json.decode(response.payload!);
        _safeNavigate(data);
      } catch (e) {}
    }
  }

  Future<void> _safeNavigate(dynamic data) async {
    final id = _normalizeId(data);
    if (id == null || _navigationLock.contains(id)) return;

    _navigationLock.add(id);
    Timer(const Duration(seconds: 10), () => _navigationLock.remove(id));

    while (navigatorKey.currentState == null) {
      await Future.delayed(const Duration(milliseconds: 500));
    }

    if (data['id'] != null) markAsRead(int.parse(data['id'].toString()));
    
    navigatorKey.currentState!.push(
      MaterialPageRoute(builder: (context) => NotificationDetailScreen(notification: data))
    );
  }

  void _cleanCache() {
    final now = DateTime.now().millisecondsSinceEpoch;
    _dedupCache.removeWhere((key, timestamp) => (now - timestamp) > _ttlMs);
    _uiBackpressureMap.removeWhere((key, timestamp) => (now - timestamp) > _uiThrottleMs);
    _isCacheDirty = true;
  }

  void _debouncedSync() {
    _reconnectDebounce?.cancel();
    _reconnectDebounce = Timer(const Duration(milliseconds: 500), () async {
      if (_isSyncing) return;
      _isSyncing = true;
      try {
        await fetchNotifications();
        _orderUpdateController.add({'type': 'sync_requested'});
      } finally {
        _isSyncing = false;
      }
    });
  }

  void _joinIdentityRoom() {
    final uuid = SessionService.instance.uuid;
    if (socket != null && socket!.connected && uuid != null) {
      socket?.emit('join:customer');
    }
  }

  Future<void> fetchNotifications() async {
    try {
      final jwt = await SessionService.instance.accessToken;
      if (jwt == null) return;
      final response = await http.get(
        Uri.parse('${ApiService.baseUrl}/notifications/my-notifications'),
        headers: {'Authorization': 'Bearer $jwt'},
      );
      if (response.statusCode == 200) {
        final List<dynamic> data = json.decode(utf8.decode(response.bodyBytes));
        notifications = data;
        unreadCount = data.where((n) => n['isRead'] == false).length;
        notifyListeners();
      }
    } catch (e) {}
  }

  Future<void> markAsRead(int id) async {
    try {
      final jwt = await SessionService.instance.accessToken;
      await http.put(Uri.parse('${ApiService.baseUrl}/notifications/$id/read'), headers: {'Authorization': 'Bearer $jwt'});
      final index = notifications.indexWhere((n) => n['id'] == id);
      if (index != -1 && !notifications[index]['isRead']) {
        notifications[index]['isRead'] = true;
        unreadCount = (unreadCount > 0) ? unreadCount - 1 : 0;
        notifyListeners();
      }
    } catch (e) {}
  }

  Future<void> _updateTokenOnBackend(String token) async {
    try {
      final jwt = await SessionService.instance.accessToken;
      if (jwt == null) return;
      await http.post(Uri.parse('${ApiService.baseUrl}/customers/fcm-token'), headers: {'Authorization': 'Bearer $jwt', 'Content-Type': 'application/json'}, body: json.encode({'fcmToken': token}));
    } catch (e) {}
  }

  @override
  void dispose() {
    _persistenceTimer?.cancel();
    _cacheCleanupTimer?.cancel();
    _reconnectDebounce?.cancel();
    _fcmSubscription?.cancel();
    _orderUpdateController.close();
    socket?.dispose();
    super.dispose();
  }

  /// 🏛️ [V5 Priority 2] Static Helper for Early Initialization
  static Future<void> createNotificationChannel() async {
    const channel = AndroidNotificationChannel(
      'almarkazia_channel',
      'Al Markazia Notifications',
      importance: Importance.max,
      playSound: true,
      enableVibration: true,
      showBadge: true,
    );

    final FlutterLocalNotificationsPlugin localNotifications = FlutterLocalNotificationsPlugin();
    await localNotifications.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);
    
    print('📡 [NotificationService V5] System Channel Registered.');
  }
}
