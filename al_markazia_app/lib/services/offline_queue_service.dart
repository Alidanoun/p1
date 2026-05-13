import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import '../models/offline_request.dart';
import '../utils/conflict_resolver.dart';
import '../utils/logger.dart';
import 'api_service.dart';
import 'storage_service.dart';

/**
 * 🔄 High-Resilience Offline Processing Service
 * Manages reliable persistence pipelines enforcing OCC synchronization constraints.
 */
class OfflineQueueService {
  static final OfflineQueueService instance = OfflineQueueService._internal();
  OfflineQueueService._internal();

  static const String _STORAGE_KEY = 'secure_offline_actions_v2';
  bool _isSyncing = false;

  // 🔐 Byte-obfuscation masking logic preventing direct unencrypted string introspection
  String _maskPayload(String payload) {
    try {
      final bytes = utf8.encode(payload);
      final salt = utf8.encode('AL_MARKAZIA_ENTERPRISE_SALT');
      final masked = List<int>.generate(bytes.length, (i) => bytes[i] ^ salt[i % salt.length]);
      return base64Encode(masked);
    } catch (_) {
      return base64Encode(utf8.encode(payload));
    }
  }

  String _unmaskPayload(String maskedBase64) {
    try {
      final bytes = base64Decode(maskedBase64);
      final salt = utf8.encode('AL_MARKAZIA_ENTERPRISE_SALT');
      final unmasked = List<int>.generate(bytes.length, (i) => bytes[i] ^ salt[i % salt.length]);
      return utf8.decode(unmasked);
    } catch (_) {
      try {
        return utf8.decode(base64Decode(maskedBase64));
      } catch (_) {
        return '[]';
      }
    }
  }

  Future<List<OfflineRequest>> getQueue() async {
    try {
      // Hardware-isolated keychain read fallback mapped securely
      final storedString = await StorageService.instance.getSecureString(_STORAGE_KEY);
      if (storedString == null || storedString.isEmpty) return [];

      final unmasked = _unmaskPayload(storedString);
      final List decoded = json.decode(unmasked) as List;
      return decoded.map((e) => OfflineRequest.fromJson(e as Map<String, dynamic>)).toList();
    } catch (err) {
      AppLogger.error('[OfflineQueue] Storage array deserialization integrity failure: $err');
      return [];
    }
  }

  Future<void> _saveQueue(List<OfflineRequest> requests) async {
    try {
      final serialized = json.encode(requests.map((e) => e.toJson()).toList());
      final masked = _maskPayload(serialized);
      await StorageService.instance.setSecureString(_STORAGE_KEY, masked);
    } catch (err) {
      AppLogger.critical('[OfflineQueue] Failed persisting synchronized aggregate list array securely: $err');
    }
  }

  /**
   * 📥 Enqueue a new versioned distributed operational task
   */
  Future<void> enqueue({
    required String entityId,
    required String endpoint,
    required String method,
    required Map<String, dynamic> payload,
    required int entityVersion,
    required bool isVersionVerified,
    required String actionType,
    String? customIdempotencyKey,
  }) async {
    try {
      final request = OfflineRequest.create(
        entityId: entityId,
        endpoint: endpoint,
        method: method,
        payload: payload,
        entityVersion: entityVersion,
        isVersionVerified: isVersionVerified,
        actionType: actionType,
        idempotencyKey: customIdempotencyKey,
      );

      final queue = await getQueue();
      queue.add(request);
      await _saveQueue(queue);

      AppLogger.success('[OfflineQueue] Synchronous modification mapped correctly. Queue capacity: ${queue.length}');
      
      // Attempt continuous synchronous flushing
      syncQueue();
    } catch (err) {
      AppLogger.critical('[OfflineQueue] Safe insertion pre-condition error: $err');
      rethrow;
    }
  }

  /**
   * 🔄 Perform Synchronous Bounded Retries Evaluation pipeline
   */
  Future<void> syncQueue() async {
    if (_isSyncing) return;
    
    final queue = await getQueue();
    if (queue.isEmpty) return;

    _isSyncing = true;
    final now = DateTime.now().toUtc();
    final remainingRequests = <OfflineRequest>[];
    final api = ApiService.instance;

    AppLogger.info('[OfflineQueue] Iterating local synchronized updates array over active connections...');

    for (final request in queue) {
      // 1. Evaluate wait scheduling constraints
      if (now.isBefore(request.nextRetryAt)) {
        remainingRequests.add(request);
        continue;
      }

      try {
        final headers = {
          'X-Entity-Version': request.entityVersion.toString(),
          'X-Client-Timestamp': request.clientTimestamp.toIso8601String(),
          'X-Request-Action': request.actionType,
          'X-Idempotency-Key': request.idempotencyKey,
        };

        final response = await api.rawRequest(
          request.endpoint,
          request.method,
          body: request.payload,
          additionalHeaders: headers,
        );

        // Success Boundaries
        if (response.statusCode >= 200 && response.statusCode < 300) {
          AppLogger.success('[OfflineQueue] Synchronous distributed block task completed successfully: ${request.id}');
          continue; // Item dropped from persistence list
        } 
        
        // Concurrency Boundary Interception
        if (response.statusCode == 409) {
          Map<String, dynamic> responseData = {};
          try {
            responseData = json.decode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
          } catch (_) {}

          await ConflictResolver.handleConflict(
            request: request,
            serverState: responseData,
          );
          
          // Conflicting items get discarded to prevent infinite sync loop updates
          continue;
        }

        throw Exception('HTTP Status code degradation response: ${response.statusCode}');
      } catch (err) {
        AppLogger.warn('[OfflineQueue] Execution layer delivery failure for packet ${request.id}: $err');

        final updatedRetryCount = request.retryCount + 1;
        
        if (updatedRetryCount >= 5) {
          AppLogger.critical('[OfflineQueue] Maximum retry attempts exceeded. Discarding operational packet.');
          continue;
        }

        // Bounded Exponential Backoff calculation capped at 30 seconds max interval
        final backoffSeconds = min(30, pow(2, updatedRetryCount).toInt() + 1);
        final nextTryDate = DateTime.now().toUtc().add(Duration(seconds: backoffSeconds));

        final scheduledRequest = request.copyWith(
          retryCount: updatedRetryCount,
          nextRetryAt: nextTryDate,
        );

        remainingRequests.add(scheduledRequest);
      }
    }

    await _saveQueue(remainingRequests);
    _isSyncing = false;
  }
}
