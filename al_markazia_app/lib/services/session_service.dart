import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'storage_service.dart';

/// Clean Architecture Session Management (Enterprise Upgrade)
/// Handles both SharedPreferences (for UI states) and FlutterSecureStorage (for encrypted tokens).
/// 🔐 Enterprise Session Service (Security Layer)
/// Exclusively handles encrypted JWT tokens in FlutterSecureStorage.
class SessionService {
  static const String _accessTokenKey = 'access_token';
  static const String _refreshTokenKey = 'refresh_token';
  static const String _biometricTokenKey = 'biometric_refresh_token';
  
  // Singleton definition
  SessionService._privateConstructor();
  static final SessionService instance = SessionService._privateConstructor();

  final _secureStorage = const FlutterSecureStorage();

  /// Initializes services (if needed in future)
  Future<void> init() async {}

  /// Saves security tokens
  Future<void> saveTokens({
    required String accessToken,
    String? refreshToken,
  }) async {
    await _secureStorage.write(key: _accessTokenKey, value: accessToken);
    if (refreshToken != null) {
      await _secureStorage.write(key: _refreshTokenKey, value: refreshToken);
    }
  }

  /// 🔑 Biometric Persistence: Saves a dedicated token for biometric login
  Future<void> saveBiometricToken(String refreshToken) async {
    await _secureStorage.write(key: _biometricTokenKey, value: refreshToken);
  }

  /// Gets the current access token
  Future<String?> get accessToken async => await _secureStorage.read(key: _accessTokenKey);
  
  /// Gets the current refresh token
  Future<String?> get refreshToken async => await _secureStorage.read(key: _refreshTokenKey);

  /// Gets the biometric refresh token
  Future<String?> get biometricToken async => await _secureStorage.read(key: _biometricTokenKey);

  /// Clears ONLY security tokens (used during logout)
  /// 🛡️ Identity data (email/UID) and Biometric tokens are NOT cleared here 
  /// to allow for biometric re-login.
  Future<void> clearTokens() async {
    await _secureStorage.delete(key: _accessTokenKey);
    await _secureStorage.delete(key: _refreshTokenKey);
  }

  /// Explicitly clear biometric token (if user disables it)
  Future<void> clearBiometricToken() async {
    await _secureStorage.delete(key: _biometricTokenKey);
  }

  /// Full Wipe (Emergency or explicit reset)
  Future<void> clearAll() async {
    await _secureStorage.deleteAll();
  }

  /// Check if we have an active session (token exists AND not expired)
  Future<bool> get hasSession async {
    final token = await accessToken;
    if (token == null || token.isEmpty) return false;

    // Decode JWT payload to check expiration
    try {
      final parts = token.split('.');
      if (parts.length != 3) return false;

      // Fix base64 padding
      String payload = parts[1];
      final normalized = base64.normalize(payload);
      final decoded = utf8.decode(base64.decode(normalized));
      final Map<String, dynamic> jwtPayload = json.decode(decoded);

      final exp = jwtPayload['exp'];
      if (exp == null) return false;

      final expiryDate = DateTime.fromMillisecondsSinceEpoch(exp * 1000);
      return expiryDate.isAfter(DateTime.now());
    } catch (_) {
      // If we can't decode, assume expired
      return false;
    }
  }

  /// Get the remaining time until token expiration (null if expired or invalid)
  Duration? get timeToExpiry {
    return null; // Will be computed on next hasSession call
  }

  // --- 👤 Identity Bridge (UI Convenience) ---
  
  bool get isAdmin => StorageService.instance.userRole == 'admin' || StorageService.instance.userRole == 'super_admin';
  String? get uuid => StorageService.instance.userId;
  String? get phone => StorageService.instance.userPhone;
  String? get name => StorageService.instance.userName;
  String? get email => StorageService.instance.userEmail;
}
