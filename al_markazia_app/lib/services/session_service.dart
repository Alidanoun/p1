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

  // 🔒 Memory cache for synchronous getters
  String? _uuid;
  String? _role;
  String? _phone;

  /// Initializes services. Must be called early (e.g. main.dart)
  Future<void> init() async {
    _prefs ??= await SharedPreferences.getInstance();
    _uuid = await _secureStorage.read(key: _userUuidKey);
    _role = await _secureStorage.read(key: _userRoleKey);
    _phone = await _secureStorage.read(key: _userPhoneKey);
    
    // Auto-migrate legacy prefs to secure storage if found
    if (_prefs!.containsKey(_userUuidKey)) {
      _uuid = _prefs!.getString(_userUuidKey);
      await _secureStorage.write(key: _userUuidKey, value: _uuid);
      await _prefs!.remove(_userUuidKey);
    }
    if (_prefs!.containsKey(_userRoleKey)) {
      _role = _prefs!.getString(_userRoleKey);
      await _secureStorage.write(key: _userRoleKey, value: _role);
      await _prefs!.remove(_userRoleKey);
    }
    if (_prefs!.containsKey(_userPhoneKey)) {
      _phone = _prefs!.getString(_userPhoneKey);
      await _secureStorage.write(key: _userPhoneKey, value: _phone);
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
    
    // Encrypted Storage for Tokens & Identity
    if (accessToken != null) await _secureStorage.write(key: _accessTokenKey, value: accessToken);
    if (refreshToken != null) await _secureStorage.write(key: _refreshTokenKey, value: refreshToken);
    
    if (uuid != null) {
      await _secureStorage.write(key: _userUuidKey, value: uuid);
      _uuid = uuid;
    }
    if (role != null) {
      await _secureStorage.write(key: _userRoleKey, value: role);
      _role = role;
    }
    if (phone != null) {
      await _secureStorage.write(key: _userPhoneKey, value: phone);
      _phone = phone;
    }

    // Persistent UI state
    if (name != null) await _prefs!.setString(_userNameKey, name);
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
    
    _uuid = null;
    _role = null;
    _phone = null;

    // Wipe Prefs
    await _prefs!.remove(_userNameKey);
    await _prefs!.remove(_userUuidKey);
    await _prefs!.remove(_userRoleKey);
    await _prefs!.remove(_userPhoneKey); 
  }

  // --- Getters ---
  String? get uuid => _uuid;
  String? get name => _prefs?.getString(_userNameKey);
  String? get role => _role;
  String? get phone => _phone;

  /// Check if a user is currently logged in (based on existence of secure token)
  Future<bool> get isLoggedIn async {
    final token = await accessToken;
    return token != null && token.isNotEmpty;
  }
  
  /// Check if the currently logged-in user is an Admin
  bool get isAdmin => role == 'admin';
}
