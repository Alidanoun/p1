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
  /// 🛡️ Identity data (email/UID) and Biometric tokens are NOT cleared here.
  Future<void> clearTokens() async {
    await _secureStorage.delete(key: _accessTokenKey);
    await _secureStorage.delete(key: _refreshTokenKey);
    await _secureStorage.delete(key: _biometricTokenKey);
  }

  /// Explicitly clear biometric token (if user disables it)
  Future<void> clearBiometricToken() async {
    await _secureStorage.delete(key: _biometricTokenKey);
  }

  /// Full Wipe (Emergency or explicit reset)
  Future<void> clearAll() async {
    await _secureStorage.deleteAll();
  }

  /// Check if we have an active session (based on token existence)
  Future<bool> get hasSession async {
    final token = await accessToken;
    return token != null && token.isNotEmpty;
  }

  // --- 👤 Identity Bridge (UI Convenience) ---
  
  bool get isAdmin => StorageService.instance.userRole == 'admin' || StorageService.instance.userRole == 'super_admin';
  String? get uuid => StorageService.instance.userId;
  String? get phone => StorageService.instance.userPhone;
  String? get name => StorageService.instance.userName;
  String? get email => StorageService.instance.userEmail;
}
