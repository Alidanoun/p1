import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Clean Architecture Session Management (Enterprise Upgrade)
/// Handles both SharedPreferences (for UI states) and FlutterSecureStorage (for encrypted tokens).
class SessionService {
  static const String _accessTokenKey = 'access_token';
  static const String _refreshTokenKey = 'refresh_token';
  
  static const String _userPhoneKey = 'user_phone'; // Legacy key for cleanup
  static const String _userNameKey = 'user_name';
  static const String _userUuidKey = 'user_uuid';
  static const String _userRoleKey = 'user_role';

  // Singleton definition
  SessionService._privateConstructor();
  static final SessionService instance = SessionService._privateConstructor();

  SharedPreferences? _prefs;
  final _secureStorage = const FlutterSecureStorage();

  /// Initializes services. Must be called early (e.g. main.dart)
  Future<void> init() async {
    _prefs ??= await SharedPreferences.getInstance();
    await _handleLegacyCleanup();
  }

  /// 🧹 Legacy Cleanup (Architect Directive)
  /// Deletes unencrypted phone data once we have a secure UUID/JWT session.
  Future<void> _handleLegacyCleanup() async {
    if (_prefs == null) return;
    
    final hasNewSession = await _secureStorage.containsKey(key: _accessTokenKey);
    if (hasNewSession && _prefs!.containsKey(_userPhoneKey)) {
      print('🧹 SessionService: Cleaning up legacy user_phone data...');
      await _prefs!.remove(_userPhoneKey);
    }
  }

  /// Standardized way to save complete user session from Map
  Future<void> saveUser(Map<String, dynamic> data) async {
    final user = data['user'] ?? data;
    await saveSession(
      accessToken: data['accessToken']?.toString(),
      refreshToken: data['refreshToken']?.toString(),
      name: user['name']?.toString(),
      uuid: user['id']?.toString(), // Assuming backend sends UUID as 'id'
      role: user['role']?.toString(),
      phone: user['phone']?.toString(),
    );
  }

  /// Saves the complete session or partial data
  Future<void> saveSession({
    String? accessToken,
    String? refreshToken,
    String? name,
    String? uuid,
    String? role,
    String? phone,
  }) async {
    if (_prefs == null) await init();
    
    // Encrypted Storage for Tokens
    if (accessToken != null) await _secureStorage.write(key: _accessTokenKey, value: accessToken);
    if (refreshToken != null) await _secureStorage.write(key: _refreshTokenKey, value: refreshToken);
    
    // Persistent UI state
    if (name != null) await _prefs!.setString(_userNameKey, name);
    if (uuid != null) await _prefs!.setString(_userUuidKey, uuid);
    if (role != null) await _prefs!.setString(_userRoleKey, role);
    if (phone != null) await _prefs!.setString(_userPhoneKey, phone);

    // After saving new session, ensure legacy phone is CLEAN if we have a new UUID-based session
    // Wait, actually if we want to support phone display, we should KEEP it.
    // The previous _handleLegacyCleanup was deleting it. I will remove that call.
    // await _handleLegacyCleanup();
  }

  /// Gets the current access token from secure storage
  Future<String?> get accessToken async => await _secureStorage.read(key: _accessTokenKey);
  
  /// Gets the current refresh token from secure storage
  Future<String?> get refreshToken async => await _secureStorage.read(key: _refreshTokenKey);

  /// Clears all session data (Logout)
  Future<void> clearSession() async {
    if (_prefs == null) await init();
    
    // Wipe Secure Storage
    await _secureStorage.deleteAll();
    
    // Wipe Prefs
    await _prefs!.remove(_userNameKey);
    await _prefs!.remove(_userUuidKey);
    await _prefs!.remove(_userRoleKey);
    await _prefs!.remove(_userPhoneKey); // Ensure legacy is wiped too
  }

  // --- Getters ---
  String? get uuid => _prefs?.getString(_userUuidKey);
  String? get name => _prefs?.getString(_userNameKey);
  String? get role => _prefs?.getString(_userRoleKey);
  String? get phone => _prefs?.getString(_userPhoneKey);

  /// Check if a user is currently logged in (based on existence of secure token)
  Future<bool> get isLoggedIn async {
    final token = await accessToken;
    return token != null && token.isNotEmpty;
  }
  
  /// Check if the currently logged-in user is an Admin
  bool get isAdmin => role == 'admin';
}
