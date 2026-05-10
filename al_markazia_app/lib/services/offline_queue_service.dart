import 'dart:convert';
import 'package:uuid/uuid.dart';
import 'storage_service.dart';
import 'api_service.dart';
import '../utils/logger.dart';

/**
 * 🔄 Offline Action Queue (Phase 3 Resilience)
 * Persists user actions during network failures and retries them automatically.
 */
class OfflineQueueService {
  static final OfflineQueueService instance = OfflineQueueService._();
  OfflineQueueService._();

  static const String _STORAGE_KEY = 'pending_offline_actions_v1';
  final _uuid = Uuid();

  /**
   * 📥 Enqueue a new action
   */
  Future<void> enqueue(String endpoint, String method, Map<String, dynamic> body) async {
    final action = {
      'id': _uuid.v4(),
      'endpoint': endpoint,
      'method': method,
      'body': body,
      'createdAt': DateTime.now().toIso8601String(),
      'retries': 0
    };

    final List<dynamic> currentQueue = await _getQueue();
    currentQueue.add(action);
    await _saveQueue(currentQueue);
    
    AppLogger.info('OfflineQueue: Action enqueued - $endpoint');
    
    // Attempt immediate sync if connection might be back
    sync(); 
  }

  /**
   * 🔄 Sync pending actions to server
   */
  Future<void> sync() async {
    final List<dynamic> queue = await _getQueue();
    if (queue.isEmpty) return;

    AppLogger.info('OfflineQueue: Starting sync for ${queue.length} actions');
    
    final List<dynamic> remaining = [];
    final api = ApiService.instance;

    for (var action in queue) {
      try {
        final res = await api.rawRequest(
          action['endpoint'],
          action['method'],
          body: action['body'],
        );

        if (res.statusCode >= 200 && res.statusCode < 300) {
          AppLogger.success('OfflineQueue: Action synced successfully - ${action['id']}');
        } else {
          throw Exception('Server returned ${res.statusCode}');
        }
      } catch (e) {
        AppLogger.error('OfflineQueue: Sync failed for ${action['id']} - $e');
        action['retries']++;
        if (action['retries'] < 5) {
          remaining.add(action);
        } else {
          AppLogger.critical('OfflineQueue: Action ${action['id']} dropped after max retries');
          // TODO: Notify user of failed permanent action
        }
      }
    }

    await _saveQueue(remaining);
  }

  Future<List<dynamic>> _getQueue() async {
    final String? data = StorageService.instance.getString(_STORAGE_KEY);
    if (data == null) return [];
    return jsonDecode(data) as List<dynamic>;
  }

  Future<void> _saveQueue(List<dynamic> queue) async {
    await StorageService.instance.setString(_STORAGE_KEY, jsonEncode(queue));
  }
}
