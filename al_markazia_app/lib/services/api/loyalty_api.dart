import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../api_service.dart';
import '../../core/errors/app_exception.dart';

/// 🎁 Loyalty & Rewards API
/// Handles all loyalty-related endpoints extracted from ApiService.
class LoyaltyApi {
  static String get baseUrl => ApiService.baseUrl;

  /// Fetch current Happy Hour / Loyalty campaign status.
  Future<Map<String, dynamic>> fetchLoyaltyStatus(
    Map<String, String> headers,
  ) async {
    final response = await http
        .get(Uri.parse('$baseUrl/loyalty/status'), headers: headers)
        .timeout(const Duration(seconds: 8));

    if (response.statusCode == 401) throw const AuthException();
    if (response.statusCode == 200) {
      final decoded = json.decode(utf8.decode(response.bodyBytes));
      return (decoded['data'] as Map<String, dynamic>?) ?? {};
    }
    return {'isHappyHourEnabled': false};
  }

  /// Fetch all items in the rewards store.
  Future<List<dynamic>> fetchRewardsStore(Map<String, String> headers) async {
    final response = await http
        .get(Uri.parse('$baseUrl/loyalty/store'), headers: headers)
        .timeout(const Duration(seconds: 10));

    if (response.statusCode == 401) throw const AuthException();
    if (response.statusCode == 200) {
      final decoded = json.decode(utf8.decode(response.bodyBytes));
      return (decoded['data'] as List?) ?? [];
    }
    throw appExceptionFromHttp(
      response.statusCode,
      _tryDecode(response.bodyBytes),
    );
  }

  /// Fetch the customer's full loyalty profile (points, tier, streak, etc.)
  Future<Map<String, dynamic>> fetchLoyaltyProfile(
    Map<String, String> headers,
  ) async {
    final response = await http
        .get(Uri.parse('$baseUrl/loyalty/profile'), headers: headers)
        .timeout(const Duration(seconds: 10));

    if (response.statusCode == 401) throw const AuthException();
    if (response.statusCode == 200) {
      final decoded = json.decode(utf8.decode(response.bodyBytes));
      return (decoded['data'] as Map<String, dynamic>?) ?? {};
    }
    throw appExceptionFromHttp(
      response.statusCode,
      _tryDecode(response.bodyBytes),
    );
  }

  /// Fetch the customer's point ledger (history of earn/burn events).
  Future<List<dynamic>> fetchLoyaltyLedger(Map<String, String> headers) async {
    final response = await http
        .get(Uri.parse('$baseUrl/loyalty/ledger'), headers: headers)
        .timeout(const Duration(seconds: 10));

    if (response.statusCode == 401) throw const AuthException();
    if (response.statusCode == 200) {
      final decoded = json.decode(utf8.decode(response.bodyBytes));
      return (decoded['data'] as List?) ?? [];
    }
    throw appExceptionFromHttp(
      response.statusCode,
      _tryDecode(response.bodyBytes),
    );
  }

  /// Claim (redeem) a reward from the rewards store.
  Future<Map<String, dynamic>> claimReward(
    int rewardId,
    Map<String, String> headers,
  ) async {
    final response = await http
        .post(
          Uri.parse('$baseUrl/loyalty/store/claim'),
          headers: headers,
          body: json.encode({'rewardId': rewardId}),
        )
        .timeout(const Duration(seconds: 10));

    if (response.statusCode == 401) throw const AuthException();

    final decoded = json.decode(utf8.decode(response.bodyBytes));
    if (response.statusCode == 200 && decoded['success'] == true) {
      return decoded['data'] as Map<String, dynamic>;
    }

    throw appExceptionFromHttp(response.statusCode, decoded);
  }

  /// Trigger a social-share reward (one-time bonus per session).
  Future<Map<String, dynamic>?> triggerSocialShareReward(
    Map<String, String> headers,
  ) async {
    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/loyalty/share-product'),
            headers: headers,
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        return json.decode(utf8.decode(response.bodyBytes));
      }
    } catch (e) {
      debugPrint('⚠️ [LoyaltyApi] Social share reward failed: $e');
    }
    return null;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  Map<String, dynamic>? _tryDecode(List<int> bytes) {
    try {
      final body = json.decode(utf8.decode(bytes));
      return body is Map<String, dynamic> ? body : null;
    } catch (_) {
      return null;
    }
  }
}
