import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'api_service.dart';
import 'session_service.dart';
import '../main.dart';
import '../screens/notifications_screen.dart';
import '../screens/notification_detail_screen.dart';
import 'package:flutter/services.dart'; // 🛡️ Required for Haptics

/// 🧠 Notification Event Fingerprint (Enterprise Deduplication)
class NotificationFingerprint {
  final String? notificationId;
  final String? orderId;
  final String? status;
  final int? version;
  final int timestamp;
  final String? priority; // 🛡️ CRITICAL, HIGH, MEDIUM, LOW
  final String? deduplicationKey;
  final int ttl;

  NotificationFingerprint({
    this.notificationId, 
    this.orderId, 
    this.status, 
    this.version,
    required this.timestamp,
    this.priority = 'HIGH',
    this.deduplicationKey,
    this.ttl = 15000, // ⏳ Increased to 15s to match backend
  });

  factory NotificationFingerprint.fromJson(Map<String, dynamic>? data) {
    if (data == null) return NotificationFingerprint(timestamp: DateTime.now().millisecondsSinceEpoch);
    return NotificationFingerprint(
      notificationId: data['notificationId']?.toString(),
      orderId: data['orderId']?.toString(),
      status: data['status']?.toString(),
      version: data['version'] is int ? data['version'] : int.tryParse(data['version']?.toString() ?? ''),
      priority: data['priority']?.toString() ?? 'HIGH',
      deduplicationKey: data['deduplicationKey']?.toString(),
      timestamp: data['timestamp'] ?? DateTime.now().millisecondsSinceEpoch,
      ttl: data['ttl'] ?? 15000,
    );
  }

  bool isExpired() {
    final now = DateTime.now().millisecondsSinceEpoch;
    return (now - timestamp) > ttl;
  }

  bool matches(NotificationFingerprint other) {
    if (notificationId != null && notificationId == other.notificationId) return true;
    if (orderId != null && orderId == other.orderId && status == other.status) return true;
    return false;
  }
}

class NotificationService extends ChangeNotifier {
  static final NotificationService _instance = NotificationService._internal();
  factory NotificationService() => _instance;
  NotificationService._internal();

  IO.Socket? socket;
  final FirebaseMessaging _fcm = FirebaseMessaging.instance;
  List<dynamic> notifications = [];
  int unreadCount = 0;
  
  // 📡 Real-time Stream for UI components (e.g. OrderController)
  final _orderUpdateController = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get orderUpdateStream => _orderUpdateController.stream;
  
  bool _isInitialized = false;
  bool _isFCMListenersRegistered = false;
  bool _isSyncing = false;
  Timer? _reconnectDebounce;
  
  // 🛡️ Smart Deduplication & Cache (Key -> Timestamp)
  final Map<String, int> _processedFingerprints = {};
  
  // 🛡️ Version Guard (OrderId -> LatestVersion)
  final Map<String, int> _orderLastVersions = {};

  final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();

  /// 🏛️ Enterprise Identity Initialization
  Future<void> init() async {
    final token = await SessionService.instance.accessToken;

    if (!_isInitialized) {
      // 1. Setup Local Notifications
      const AndroidInitializationSettings initSettingsAndroid = AndroidInitializationSettings('@mipmap/ic_launcher');
      const DarwinInitializationSettings initSettingsIOS = DarwinInitializationSettings(
        requestSoundPermission: true, requestBadgePermission: true, requestAlertPermission: true,
      );
      await _localNotifications.initialize(
        const InitializationSettings(android: initSettingsAndroid, iOS: initSettingsIOS),
        onDidReceiveNotificationResponse: _onSelectNotification,
      );

      // 2. 🛡️ Hardened Socket Setup with JWT & Auto-Reconnect
      socket = IO.io(ApiService.baseUrl, <String, dynamic>{
        'transports': ['websocket'],
        'autoConnect': true,
        'auth': {'token': token}, // 🔐 Handshake Auth
        'extraHeaders': {'x-auth-token': token ?? ''},
      });

      socket?.onConnect((_) {
        print('📡 Socket Connected: room:customer');
        _joinIdentityRoom();
        _debouncedSync(); // 🔄 Reconcile state after internet return
      });

      socket?.onDisconnect((_) {
        print('📡 Socket Disconnected. Attempting exponential backoff reconnect...');
        _attemptReconnect();
      });

      socket?.on('event:order:updated', _handleOrderUpdate);
      socket?.on('new_broadcast', _handleNewNotification);
      
      _isInitialized = true;
    } else {
       // If already initialized but token might have changed (re-login)
       socket?.io.options?['auth'] = {'token': token};
       _joinIdentityRoom();
    }

    await fetchNotifications();
    await _setupFCM();
  }

  void _debouncedSync() {
    _reconnectDebounce?.cancel();
    _reconnectDebounce = Timer(const Duration(milliseconds: 500), () async {
      if (_isSyncing) return;
      _isSyncing = true;
      print('🔄 Reconnected Sync Triggered...');
      try {
        await fetchNotifications();
        // Notify state controllers to refresh
        _orderUpdateController.add({'type': 'sync_requested'});
      } finally {
        _isSyncing = false;
      }
    });
  }

  void _attemptReconnect() {
    // Socket.io-client for Dart handles reconnection automatically with backoff,
    // but we ensure identity room is rejoined via onConnect.
    if (socket?.disconnected ?? true) {
      socket?.connect();
    }
  }

  /// 🔐 Join Standardized Room
  void _joinIdentityRoom() {
    final uuid = SessionService.instance.uuid;
    if (socket != null && socket!.connected && uuid != null) {
      print('🛡️ Joining standardized room: room:customer:$uuid');
      socket?.emit('join:customer');
    }
  }

  void _handleOrderUpdate(dynamic data) {
    print('📦 Real-time Order Update Received: $data');
    
    // 0. Extract Fingerprint
    final fingerprint = NotificationFingerprint.fromJson(data['fingerprint']);
    
    // 🛡️ TTL Safety: Ignore stale notifications (Delayed FCM)
    if (fingerprint.isExpired()) {
      print('⏳ Stale notification ignored: ${fingerprint.notificationId}');
      return;
    }
    
    // 1. Deduplication Guard
    final hash = _generateFingerprintHash(fingerprint);
    if (_processedFingerprints.containsKey(hash)) {
      print('🛡️ Duplicate event ignored: ${fingerprint.notificationId}');
      return;
    }
    _markAsProcessed(fingerprint);

    // 2. Push to Stream for specifically matched controllers (Card Highlight)
    if (data is Map<String, dynamic>) {
       _orderUpdateController.add(data);
    }
    
    // 3. Global notification UI handling
    if (data['notification'] != null) {
      _handleNewNotification(data['notification'], fingerprint: fingerprint);
    }
    
    notifyListeners(); 
  }

  String _generateFingerprintHash(NotificationFingerprint f) {
    // Standardize the hash based on the deduplication key or the composite ID
    return f.deduplicationKey ?? '${f.notificationId}_${f.orderId}_${f.version}';
  }

  bool _isAlreadyProcessed(NotificationFingerprint f) {
    final hash = _generateFingerprintHash(f);
    final now = DateTime.now().millisecondsSinceEpoch;
    
    // 1. Time-based Deduplication Check
    if (_processedFingerprints.containsKey(hash)) {
      final processedAt = _processedFingerprints[hash]!;
      if ((now - processedAt) < f.ttl) {
        return true; // Already handled recently
      }
    }
    
    // 2. 🛡️ Version Guard check (Ignore older versions)
    if (f.orderId != null && f.version != null) {
      final lastVersion = _orderLastVersions[f.orderId] ?? 0;
      if (f.version! < lastVersion) {
        print('🛡️ Stale version ignored: ${f.version} < $lastVersion');
        return true; 
      }
    }
    
    return false;
  }

  void _markAsProcessed(NotificationFingerprint f) {
    final hash = _generateFingerprintHash(f);
    _processedFingerprints[hash] = DateTime.now().millisecondsSinceEpoch;
    
    if (f.orderId != null && f.version != null) {
      _orderLastVersions[f.orderId!] = f.version!;
    }
    
    // 🧠 Cleanup logic (Keep Map compact)
    if (_processedFingerprints.length > 300) {
      _processedFingerprints.removeWhere((key, time) => 
        (DateTime.now().millisecondsSinceEpoch - time) > 30000); // 30s expiry
    }
  }

  Future<void> _setupFCM() async {
    NotificationSettings settings = await _fcm.requestPermission();

    if (settings.authorizationStatus == AuthorizationStatus.authorized) {
      String? token = await _fcm.getToken();
      if (token != null) {
        await _updateTokenOnBackend(token);
      }

      if (!_isFCMListenersRegistered) {
        // 🛡️ Enterprise Topic Scoping (Plan V13 Hardening)
        if (SessionService.instance.isAdmin) {
          print('🔔 Professional Staff Topic Subscribed');
          await _fcm.subscribeToTopic('staff_orders');
          // Ensure they are NOT on the broad public list
          await _fcm.unsubscribeFromTopic('all_users');
        } else {
          // Normal users stay on the public list but receive sensitive info via customer_ ID room
          await _fcm.subscribeToTopic('all_users');
          await _fcm.unsubscribeFromTopic('staff_orders');
        }

        FirebaseMessaging.onMessage.listen((RemoteMessage message) {
          final fingerprint = NotificationFingerprint.fromJson(message.data['fingerprint'] != null ? json.decode(message.data['fingerprint']) : null);
          
          if (_isAlreadyProcessed(fingerprint)) {
            print('🛡️ FCM Duplicate ignored (already handled by Socket)');
            return;
          }
          _markAsProcessed(fingerprint);

          if (message.notification != null) {
            _handleNewNotification({
              'id': message.data['id'],
              'title': message.notification!.title,
              'message': message.notification!.body,
              'type': message.data['type'],
              'createdAt': DateTime.now().toIso8601String(),
            }, fingerprint: fingerprint);
          }
        });
        _isFCMListenersRegistered = true;
      }
    }
  }

  /// 🔐 Authenticated FCM Token Sync
  Future<void> _updateTokenOnBackend(String token) async {
    try {
      final jwt = await SessionService.instance.accessToken;
      if (jwt == null) return;

      final response = await http.post(
        Uri.parse('${ApiService.baseUrl}/customers/fcm-token'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $jwt',
        },
        body: json.encode({'fcmToken': token}), // No phone required, backend uses JWT
      );
      if (response.statusCode == 200) {
        print('✅ FCM Token secured for UID: ${SessionService.instance.uuid}');
      }
    } catch (e) {
      print('❌ Failed to sync FCM token: $e');
    }
  }

  void _handleNewNotification(dynamic data, {NotificationFingerprint? fingerprint}) {
    if (fingerprint != null) {
       if (_isAlreadyProcessed(fingerprint)) return; // Final safety
       _markAsProcessed(fingerprint);
    }

    final String? notificationId = data['id']?.toString();
    final bool alreadyInList = notifications.any((n) => n['id']?.toString() == notificationId);
    
    if (!alreadyInList) {
      notifications.insert(0, data);
      unreadCount++;
      notifyListeners();
    }

    // ⚡ Four-Tier Smart UX Logic
    if (WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed) {
      final priority = fingerprint?.priority ?? 'HIGH';
      
      if (priority == 'CRITICAL') {
        _triggerCriticalInteraction(data);
      } else if (priority == 'HIGH') {
        _triggerStandardInteraction(data);
      } else {
        // MEDIUM/LOW: Only notification badge/list update (already done above)
        print('💡 Silent notification processed: ${data['title']}');
      }
    } else {
      _showLocalNotification(data);
    }
  }

  void _triggerCriticalInteraction(dynamic data) {
    HapticFeedback.vibrate(); // Direct vibrate call
    HapticFeedback.heavyImpact(); // 📳 Heavy haptic pattern
    _showCriticalOverlay(data);
  }

  void _triggerStandardInteraction(dynamic data) {
    HapticFeedback.lightImpact(); // 📳 Subtle haptic
    _showInAppBanner(data);
  }

  void _showCriticalOverlay(dynamic data) {
    if (navigatorKey.currentContext == null) return;
    final overlay = Overlay.of(navigatorKey.currentContext!);
    late OverlayEntry entry;
    
    entry = OverlayEntry(
      builder: (context) => _CriticalAlertWidget(
        data: data,
        onDismiss: () => entry.remove(),
        onTap: () {
          entry.remove();
          _safeNavigate(data);
        },
      ),
    );
    
    overlay.insert(entry);
    // Critical alerts stay longer (8s) or until dismissed
    Future.delayed(const Duration(seconds: 8), () {
      if (entry.mounted) entry.remove();
    });
  }

  void _showInAppBanner(dynamic data) {
    if (navigatorKey.currentContext == null) return;
    
    // Implementation of a custom InApp Banner using Overlay
    final overlay = Overlay.of(navigatorKey.currentContext!);
    late OverlayEntry entry;
    
    entry = OverlayEntry(
      builder: (context) => Positioned(
        top: 50,
        left: 20,
        right: 20,
        child: Material(
          color: Colors.transparent,
          child: _InAppBannerWidget(
            data: data,
            onDismiss: () => entry.remove(),
            onTap: () {
              entry.remove();
              _safeNavigate(data);
            },
          ),
        ),
      ),
    );
    
    overlay.insert(entry);
    Future.delayed(const Duration(seconds: 4), () {
      if (entry.mounted) entry.remove();
    });
  }

  /// 🔐 Authenticated Fetch
  Future<void> fetchNotifications() async {
    try {
      final jwt = await SessionService.instance.accessToken;
      if (jwt == null) return;

      final response = await http.get(
        Uri.parse('${ApiService.baseUrl}/notifications/my-notifications'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $jwt',
        },
      );

      if (response.statusCode == 200) {
        final List<dynamic> data = json.decode(utf8.decode(response.bodyBytes));
        notifications = data;
        unreadCount = data.where((n) => n['isRead'] == false).length;
        notifyListeners();
      }
    } catch (e) {
      print('Failed to fetch notifications: $e');
    }
  }

  Future<void> markAsRead(int id) async {
    try {
      final jwt = await SessionService.instance.accessToken;
      await http.put(
        Uri.parse('${ApiService.baseUrl}/notifications/$id/read'),
        headers: { 'Authorization': 'Bearer $jwt' }
      );
      final index = notifications.indexWhere((n) => n['id'] == id);
      if (index != -1 && !notifications[index]['isRead']) {
        notifications[index]['isRead'] = true;
        unreadCount = (unreadCount > 0) ? unreadCount - 1 : 0;
        notifyListeners();
      }
    } catch (e) {
      print('Failed to mark read: $e');
    }
  }

  // --- UI Helpers ---
  void _onSelectNotification(NotificationResponse response) {
    if (response.payload != null) _safeNavigate(json.decode(response.payload!));
  }

  Future<void> _safeNavigate(dynamic data) async {
    while (navigatorKey.currentState == null) {
      await Future.delayed(const Duration(milliseconds: 500));
    }
    if (data['id'] != null) markAsRead(int.parse(data['id'].toString()));
    navigatorKey.currentState!.push(
      MaterialPageRoute(builder: (context) => NotificationDetailScreen(notification: data))
    );
  }

  Future<void> _showLocalNotification(dynamic data) async {
    const androidDetails = AndroidNotificationDetails('almarkazia_channel', 'Al Markazia Notifications', importance: Importance.max, priority: Priority.high);
    const platformDetails = NotificationDetails(android: androidDetails, iOS: DarwinNotificationDetails());
    await _localNotifications.show(DateTime.now().millisecond, data['title'] ?? 'New Notification', data['message'] ?? '', platformDetails, payload: json.encode(data));
  }

  void disposeSocket() {
    socket?.disconnect();
    socket?.dispose();
  }
}

class _CriticalAlertWidget extends StatelessWidget {
  final dynamic data;
  final VoidCallback onDismiss;
  final VoidCallback onTap;

  const _CriticalAlertWidget({required this.data, required this.onDismiss, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      height: double.infinity,
      color: Colors.black.withOpacity(0.4),
      padding: const EdgeInsets.symmetric(horizontal: 20),
      alignment: Alignment.center,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: const Color(0xFF1E293B), // Dark slate premium
              borderRadius: BorderRadius.circular(32),
              boxShadow: [
                BoxShadow(color: Colors.orange.withOpacity(0.3), blurRadius: 40, spreadRadius: 10),
              ],
              border: Border.all(color: Colors.orange.withOpacity(0.5), width: 2),
            ),
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.orange.withOpacity(0.15),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.emergency_share, color: Colors.orange, size: 40)
                      .animate(onPlay: (controller) => controller.repeat())
                      .shimmer(duration: 1.5.seconds)
                      .shake(duration: 500.ms),
                ),
                const SizedBox(height: 20),
                Text(
                  data['title'] ?? '🚨 تنبيه هام',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 24),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  data['message'] ?? '',
                  style: TextStyle(color: Colors.white.withOpacity(0.8), fontSize: 16, height: 1.5),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                Row(
                  children: [
                    Expanded(
                      child: TextButton(
                        onPressed: onDismiss,
                        style: TextButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          backgroundColor: Colors.white.withOpacity(0.05),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        ),
                        child: const Text('تجاهل', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.bold)),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      flex: 2,
                      child: ElevatedButton(
                        onPressed: onTap,
                        style: ElevatedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          backgroundColor: Colors.orange,
                          foregroundColor: Colors.black,
                          elevation: 0,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        ),
                        child: const Text('عرض التفاصيل', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ).animate().scale(begin: const Offset(0.8, 0.8), curve: Curves.elasticOut, duration: 600.ms).fadeIn(),
        ],
      ),
    );
  }
}

class _InAppBannerWidget extends StatelessWidget {
  final dynamic data;
  final VoidCallback onDismiss;
  final VoidCallback onTap;

  const _InAppBannerWidget({required this.data, required this.onDismiss, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return GestureDetector(
      onTap: onTap,
      onVerticalDragEnd: (_) => onDismiss(),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF2C2C2C) : Colors.white,
          borderRadius: BorderRadius.circular(20),
          boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(0.2), blurRadius: 20, offset: const Offset(0, 10)),
          ],
          border: Border.all(color: Theme.of(context).primaryColor.withOpacity(0.3)),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Theme.of(context).primaryColor.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.notifications_active, color: Theme.of(context).primaryColor, size: 24),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    data['title'] ?? 'إشعار جديد',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  Text(
                    data['message'] ?? '',
                    style: TextStyle(color: Colors.grey.shade600, fontSize: 14),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            IconButton(icon: const Icon(Icons.close, size: 20), onPressed: onDismiss),
          ],
        ),
      ).animate().slideY(begin: -1, end: 0, duration: 400.ms, curve: Curves.easeOutBack).fade(),
    );
  }
}
