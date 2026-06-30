import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import '../../../services/offline_queue_service.dart';

/// 🌐 Enterprise Connectivity Service
///
/// Monitors network state and automatically triggers the offline queue sync
/// whenever the device transitions from offline → online.
///
/// Usage:
/// ```dart
/// // In main.dart or AppLifecycleObserver:
/// ConnectivityService.instance.init();
///
/// // In a widget:
/// final isOnline = context.watch<ConnectivityService>().isConnected;
/// ```
class ConnectivityService extends ChangeNotifier {
  // ─── Singleton ───────────────────────────────────────────────────────────
  ConnectivityService._internal();
  static final ConnectivityService instance = ConnectivityService._internal();

  // ─── State ───────────────────────────────────────────────────────────────
  bool _isConnected = true;
  bool get isConnected => _isConnected;

  /// Broadcast stream so widgets/blocs can react to connectivity changes.
  final _controller = StreamController<bool>.broadcast();
  Stream<bool> get onConnectivityChanged => _controller.stream;

  StreamSubscription<List<ConnectivityResult>>? _subscription;

  // ─── Init / Dispose ──────────────────────────────────────────────────────

  /// Call once at app startup (e.g. in `main()` after `WidgetsFlutterBinding`).
  Future<void> init() async {
    // Check current state immediately
    final results = await Connectivity().checkConnectivity();
    _updateState(results);

    // Listen to future changes
    _subscription = Connectivity()
        .onConnectivityChanged
        .listen(_updateState);

    debugPrint('🌐 [Connectivity] Service initialized. Online: $_isConnected');
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _controller.close();
    super.dispose();
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  void _updateState(List<ConnectivityResult> results) {
    final wasConnected = _isConnected;
    // Connected if ANY interface is active (wifi, mobile, ethernet)
    _isConnected = results.any((r) => r != ConnectivityResult.none);

    if (_isConnected != wasConnected) {
      debugPrint(
        '🌐 [Connectivity] State changed → ${_isConnected ? "ONLINE ✅" : "OFFLINE ❌"}',
      );
      _controller.add(_isConnected);
      notifyListeners();

      // 🔄 Auto-sync offline queue when device comes back online
      if (_isConnected) {
        _triggerOfflineSync();
      }
    }
  }

  void _triggerOfflineSync() {
    debugPrint('🔄 [Connectivity] Network restored — flushing offline queue...');
    OfflineQueueService.instance.syncQueue().catchError((e) {
      debugPrint('⚠️ [Connectivity] Offline sync flush error: $e');
    });
  }
}
