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

  Future<void> init() async {
    if (_isInitialized || _isInitializing) return;
    _isInitializing = true;

    try {
      final token = await SessionService.instance.accessToken;

      // 1. 🏗️ True Persistent Dedup Load (Time-Aware)
      _loadPersistentCache();

      // 2. Local Notifications Setup
      const AndroidNotificationChannel channel = AndroidNotificationChannel(
        'almarkazia_channel',
        'Al Markazia Notifications',
        importance: Importance.max,
        playSound: true,
      );

      await _localNotifications.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(channel);

      await _localNotifications.initialize(
        const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(),
        ),
        onDidReceiveNotificationResponse: _onSelectNotification,
      );

      // 3. 🛡️ Socket Registry Guard
      _setupSocket(token);

      // 4. Cleanup Workers
      _cacheCleanupTimer?.cancel();
      _cacheCleanupTimer = Timer.periodic(const Duration(minutes: 5), (_) => _cleanCache());
      
      // Batch writer for storage safety
      _persistenceTimer?.cancel();
      _persistenceTimer = Timer.periodic(const Duration(seconds: 10), (_) => _persistCacheToStorage());

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

  void _setupSocket(String? token) {
    if (socket != null) {
      socket?.off('event:order:updated');
      socket?.clearListeners();
      socket?.disconnect();
      socket?.dispose();
    }

    socket = IO.io(ApiService.baseUrl, <String, dynamic>{
      'transports': ['websocket'],
      'autoConnect': true,
      'auth': {'token': token},
    });

    socket?.onConnect((_) {
      _joinIdentityRoom();
      _debouncedSync();
    });

    socket?.on('event:order:updated', (data) => _processIncomingEvent(data, fromSocket: true));
  }

  /// 🧠 Central Event Router (Authority-Based + Backpressure)
  void _processIncomingEvent(dynamic data, {bool fromSocket = false, bool fromFCM = false}) {
    final id = _normalizeId(data);
    if (id == null) return;

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
       } else {
         print('⏳ [Backpressure] UI sync throttled for: $id');
       }
    }

    // 3. Authority Alert Logic
    if (fromFCM && data['notification'] != null) {
      _showLocalNotification(data, normalizedId: id);
    }
    
    notifyListeners();
  }

  Future<void> _setupFCM() async {
    // 🛡️ Global Subscription Guard
    if (_fcmSubscription != null) await _fcmSubscription?.cancel();

    NotificationSettings settings = await _fcm.requestPermission(alert: true, badge: true, sound: true);

    if (settings.authorizationStatus == AuthorizationStatus.authorized) {
      String? token = await _fcm.getToken();
      if (token != null) await _updateTokenOnBackend(token);

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
      sound: RawResourceAndroidNotificationSound('default'),
    );

    await _localNotifications.show(
      notificationId,
      data['notification']?['title'] ?? 'Al Markazia',
      data['notification']?['message'] ?? '',
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
      socket?.off('event:order:updated');
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
}
