import 'dart:convert';
import 'package:uuid/uuid.dart';

/**
 * 📦 Offline Request Data Model (Optimistic Concurrency Layer)
 * Implements monotonic client version assertions and idempotency mapping.
 */
class OfflineRequest {
  final String id;
  final String entityId;
  final String endpoint;
  final String method;
  final Map<String, dynamic> payload;
  final int entityVersion;
  final bool versionVerified;
  final DateTime clientTimestamp;
  final String actionType;
  final String idempotencyKey;
  final int retryCount;
  final DateTime nextRetryAt;

  OfflineRequest._({
    required this.id,
    required this.entityId,
    required this.endpoint,
    required this.method,
    required this.payload,
    required this.entityVersion,
    required this.versionVerified,
    required this.clientTimestamp,
    required this.actionType,
    required this.idempotencyKey,
    required this.retryCount,
    required this.nextRetryAt,
  });

  /**
   * 🛡️ Safe Factory Constructor asserting versioning compliance
   */
  factory OfflineRequest.create({
    String? id,
    required String entityId,
    required String endpoint,
    required String method,
    required Map<String, dynamic> payload,
    required int entityVersion,
    required bool isVersionVerified,
    required String actionType,
    String? idempotencyKey,
  }) {
    if (!isVersionVerified) {
      throw StateError('Cannot queue offline action without verified entity version metadata');
    }

    final uuid = const Uuid();
    return OfflineRequest._(
      id: id ?? uuid.v4(),
      entityId: entityId,
      endpoint: endpoint,
      method: method,
      payload: payload,
      entityVersion: entityVersion,
      versionVerified: isVersionVerified,
      clientTimestamp: DateTime.now().toUtc(),
      actionType: actionType,
      idempotencyKey: idempotencyKey ?? uuid.v4(),
      retryCount: 0,
      nextRetryAt: DateTime.now().toUtc(),
    );
  }

  OfflineRequest copyWith({
    Map<String, dynamic>? payload,
    int? retryCount,
    DateTime? nextRetryAt,
  }) {
    return OfflineRequest._(
      id: id,
      entityId: entityId,
      endpoint: endpoint,
      method: method,
      payload: payload ?? this.payload,
      entityVersion: entityVersion,
      versionVerified: versionVerified,
      clientTimestamp: clientTimestamp,
      actionType: actionType,
      idempotencyKey: idempotencyKey,
      retryCount: retryCount ?? this.retryCount,
      nextRetryAt: nextRetryAt ?? this.nextRetryAt,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'entityId': entityId,
    'endpoint': endpoint,
    'method': method,
    'payload': payload,
    'entityVersion': entityVersion,
    'versionVerified': versionVerified,
    'clientTimestamp': clientTimestamp.toIso8601String(),
    'actionType': actionType,
    'idempotencyKey': idempotencyKey,
    'retryCount': retryCount,
    'nextRetryAt': nextRetryAt.toIso8601String(),
  };

  factory OfflineRequest.fromJson(Map<String, dynamic> json) {
    return OfflineRequest._(
      id: json['id'] as String,
      entityId: json['entityId'] as String,
      endpoint: json['endpoint'] as String,
      method: json['method'] as String,
      payload: Map<String, dynamic>.from(json['payload'] as Map),
      entityVersion: (json['entityVersion'] as num?)?.toInt() ?? 1,
      versionVerified: json['versionVerified'] as bool? ?? true,
      clientTimestamp: DateTime.tryParse(json['clientTimestamp']?.toString() ?? '') ?? DateTime.now().toUtc(),
      actionType: json['actionType'] as String? ?? 'UPDATE',
      idempotencyKey: json['idempotencyKey'] as String? ?? const Uuid().v4(),
      retryCount: (json['retryCount'] as num?)?.toInt() ?? 0,
      nextRetryAt: DateTime.tryParse(json['nextRetryAt']?.toString() ?? '') ?? DateTime.now().toUtc(),
    );
  }
}
