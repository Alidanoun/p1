import 'package:flutter/material.dart';
import 'dart:async';
import '../../services/api/auth_api.dart';
import '../../services/session_service.dart';
import '../../services/storage_service.dart';
import '../../services/notification_service.dart';
import '../../services/biometric_service.dart';
import '../../services/api_service.dart';
import '../../services/app_events.dart';

enum AuthStatus { loading, authenticated, unauthenticated, biometricRequired, sessionExpired }

class AuthController extends ChangeNotifier {
  final AuthApi _api = AuthApi();
  StreamSubscription? _eventSubscription;

  AuthStatus _status = AuthStatus.loading;
  AuthStatus get status => _status;

  bool isLoading = false;
  String? errorMessage;
  bool _initialized = false;

  /// 🛡️ Identity property (Derived from StorageService)
  Map<String, dynamic>? get user => StorageService.instance.getCurrentUser();

  // ── Biometric state ──
  bool _biometricAvailable = false;
  bool _biometricEnabled = false;

  bool get isBiometricAvailable => _biometricAvailable;
  bool get isBiometricEnabled => _biometricEnabled;

  AuthController() {
    _setupEventListeners();
    initialize();
  }

  void _setupEventListeners() {
    _eventSubscription = AppEvents.stream.listen((event) {
      if (event is SessionExpiredEvent) {
        debugPrint('🔔 [Auth] Global Session Expiry Event Detected.');
        _handleSessionExpiry();
      } else if (event is IdentityRefreshEvent) {
        debugPrint('🔔 [Auth] Identity Refresh Event Detected.');
        refreshProfile();
      }
    });
  }

  void _handleSessionExpiry() {
    _status = AuthStatus.sessionExpired;
    notifyListeners();
    // We don't force logout here to give user a chance to see the message
    // or we can call logout() if we want it to be immediate.
  }

  bool get isAuthenticated => status == AuthStatus.authenticated;

  /// 🧠 SYSTEM INITIALIZE (The Core Boot Logic)
  Future<void> initialize() async {
    if (_initialized) return;
    _initialized = true;

    _status = AuthStatus.loading;
    notifyListeners();

    try {
      final session = SessionService.instance;
      final storage = StorageService.instance;

      // 1. Check for existing access token
      if (await session.hasSession) {
        debugPrint('✅ [Auth] Valid session found in storage.');
        _status = AuthStatus.authenticated;
        _prefetchData();
      } 
      // 🛡️ Silent Restoration Flow (Refresh Token exists but Access Token is missing/expired)
      else if (await session.refreshToken != null || (storage.isBiometricEnabled && await session.biometricToken != null)) {
        debugPrint('🔄 [Auth] Access token missing. Attempting silent session restoration...');
        
        try {
          final success = await ApiService.instance.refreshTokens() != null;
          if (success) {
            _status = AuthStatus.authenticated;
            _prefetchData();
          } else {
            // 🚨 Refresh failed definitively (e.g., 401 or 403 on refresh)
            _status = _getUnauthStatus(storage);
          }
        } catch (e) {
          // ⚠️ Network error during refresh - don't log out yet, just stay unauthenticated but allow retry
          debugPrint('⚠️ [Auth] Network error during session restoration: $e');
          _status = _getUnauthStatus(storage);
        }
      } 
      else {
        _status = _getUnauthStatus(storage);
      }
    } finally {
      _initialized = true;
      await _refreshBiometricState();
      notifyListeners();
    }
  }

  AuthStatus _getUnauthStatus(StorageService storage) {
    return storage.isBiometricEnabled ? AuthStatus.biometricRequired : AuthStatus.unauthenticated;
  }

  Future<void> _refreshBiometricState() async {
    _biometricAvailable = await BiometricService.instance.isAvailable;
    _biometricEnabled = StorageService.instance.isBiometricEnabled;
    notifyListeners();
  }

  /// 🚀 Smart Session Restoration (Legacy support for splash)
  Future<Map<String, dynamic>?> restoreSession() async {
    await initialize();
    return user;
  }

  void _prefetchData() {
    if (_status != AuthStatus.authenticated) return;
    debugPrint('⚡ [Auth] Starting Smart Prefetch for User...');
    Future.wait([
      ApiService.instance.fetchCategories(),
      ApiService.instance.fetchMenuItems(),
      ApiService.instance.fetchDeliveryZones(),
    ]).then((_) => debugPrint('✅ [Auth] Prefetch Complete. UI ready.'));
  }

  /// 🔄 Refresh User Identity (Points, Tier, etc.)
  Future<void> refreshProfile() async {
    if (_status != AuthStatus.authenticated) return;
    try {
      final freshUser = await ApiService.instance.getMe();
      await StorageService.instance.setCurrentUser(freshUser);
      notifyListeners();
      debugPrint('✅ [Auth] Profile refreshed successfully.');
    } catch (e) {
      debugPrint('⚠️ [Auth] Failed to refresh profile: $e');
    }
  }

  // ════════════════════════════════════════════════════════
  //  🔐 LOGIN (Email + Password)
  // ════════════════════════════════════════════════════════
  Future<bool> login(String email, String password) async {
    _setLoading(true);
    try {
      final authResponse = await ApiService.instance.loginCustomer(email, password);
      
      if (_biometricEnabled) {
        final rt = await SessionService.instance.refreshToken;
        if (rt != null) await SessionService.instance.saveBiometricToken(rt);
      }

      _status = AuthStatus.authenticated;
      _prefetchData();
      NotificationService().reinitialize();
      _setLoading(false);
      return true;
    } catch (e) {
      errorMessage = _mapError(e.toString());
      _setLoading(false);
      return false;
    }
  }

  // ════════════════════════════════════════════════════════
  //  🔐 LOGIN (Biometrics)
  // ════════════════════════════════════════════════════════
  Future<BiometricLoginResult> loginWithBiometrics({required String reason}) async {
    // 🛡️ Security Check: Biometric Token Expiry (14 Days)
    final lastAuth = StorageService.instance.getString('biometric_token_created_at');
    if (lastAuth != null) {
      final createdAt = DateTime.parse(lastAuth);
      if (DateTime.now().difference(createdAt).inDays > 14) {
        debugPrint('🚨 [Auth] Biometric token expired (14 days). Requiring password.');
        return BiometricLoginResult(
          status: BiometricLoginStatus.sessionExpired,
          message: 'انتهت صلاحية الدخول الحيوي، يرجى استخدام كلمة المرور',
        );
      }
    }

    final result = await BiometricService.instance.authenticate(reason: reason);
    if (!result.success) {
      if (result.isLockedOut) {
        return BiometricLoginResult(
          status: BiometricLoginStatus.lockedOut,
          message: result.message,
        );
      }
      return BiometricLoginResult(
        status: BiometricLoginStatus.failed,
        message: result.wasCancelled ? null : result.message,
      );
    }

    _setLoading(true);
    try {
      final newAccessToken = await ApiService.instance.refreshTokens();

      if (newAccessToken == null) {
        _status = AuthStatus.sessionExpired;
        _setLoading(false);
        return BiometricLoginResult(
          status: BiometricLoginStatus.sessionExpired,
          message: 'انتهت صلاحية الجلسة، يرجى الدخول بكلمة المرور',
        );
      }

      _status = AuthStatus.authenticated;
      _prefetchData();
      NotificationService().reinitialize();
      _setLoading(false);
      return BiometricLoginResult(status: BiometricLoginStatus.success);
    } catch (e) {
      _setLoading(false);
      return BiometricLoginResult(
        status: BiometricLoginStatus.failed, 
        message: 'حدث خطأ أثناء محاولة الدخول، يرجى المحاولة لاحقاً'
      );
    }
  }

  // ════════════════════════════════════════════════════════
  //  🔐 BIOMETRIC PREFERENCE
  // ════════════════════════════════════════════════════════

  Future<bool> enableBiometrics({required String reason}) async {
    final result = await BiometricService.instance.authenticate(reason: reason);
    if (!result.success) return false;

    final currentRefresh = await SessionService.instance.refreshToken;
    if (currentRefresh != null) {
      await SessionService.instance.saveBiometricToken(currentRefresh);
    }

    await StorageService.instance.setBiometricEnabled(true);
    await StorageService.instance.setString('biometric_token_created_at', DateTime.now().toIso8601String());
    _biometricEnabled = true;
    notifyListeners();
    return true;
  }

  Future<void> disableBiometrics() async {
    await StorageService.instance.setBiometricEnabled(false);
    await SessionService.instance.clearBiometricToken();
    _biometricEnabled = false;
    notifyListeners();
  }

  // ════════════════════════════════════════════════════════
  //  📝 REGISTER
  // ════════════════════════════════════════════════════════
  Future<bool> register({
    required String name,
    required String email,
    required String password,
    required String phone,
  }) async {
    _setLoading(true);
    try {
      await ApiService.instance.registerCustomer(
        name: name,
        email: email,
        password: password,
        phone: phone,
      );
      _setLoading(false);
      return true;
    } catch (e) {
      errorMessage = _mapError(e.toString());
      _setLoading(false);
      return false;
    }
  }

  Future<bool> verifyOtp(String email, String code) async {
    _setLoading(true);
    try {
      final authResponse = await _api.verifyRegistration(email, code);
      await SessionService.instance.saveTokens(
        accessToken: authResponse['accessToken'],
        refreshToken: authResponse['refreshToken'],
      );
      await StorageService.instance.setCurrentUser(authResponse['user']);
      
      if (_biometricEnabled) {
        final rt = await SessionService.instance.refreshToken;
        if (rt != null) await SessionService.instance.saveBiometricToken(rt);
      }

      _status = AuthStatus.authenticated;
      _prefetchData();
      NotificationService().reinitialize();
      _setLoading(false);
      return true;
    } catch (e) {
      errorMessage = _mapError(e.toString());
      _setLoading(false);
      return false;
    }
  }

  // ════════════════════════════════════════════════════════
  //  🔑 FORGOT PASSWORD
  // ════════════════════════════════════════════════════════
  Future<bool> forgotPassword(String email) async {
    _setLoading(true);
    try {
      await _api.forgotPassword(email);
      _setLoading(false);
      return true; 
    } catch (e) {
      errorMessage = _mapError(e.toString());
      _setLoading(false);
      return false;
    }
  }

  Future<bool> resetPassword({
    required String email,
    required String code,
    required String newPassword,
  }) async {
    _setLoading(true);
    try {
      final authResponse = await _api.resetPassword(
        email: email,
        code: code,
        newPassword: newPassword,
      );
      await SessionService.instance.saveTokens(
        accessToken: authResponse['accessToken'],
        refreshToken: authResponse['refreshToken'],
      );
      await StorageService.instance.setCurrentUser(authResponse['user']);
      
      if (_biometricEnabled) {
        final rt = await SessionService.instance.refreshToken;
        if (rt != null) await SessionService.instance.saveBiometricToken(rt);
      }

      _status = AuthStatus.authenticated;
      _prefetchData();
      _setLoading(false);
      return true;
    } catch (e) {
      errorMessage = _mapError(e.toString());
      _setLoading(false);
      return false;
    }
  }

  // ════════════════════════════════════════════════════════
  //  🚪 LOGOUT
  // ════════════════════════════════════════════════════════
  Future<void> logout() async {
    await BiometricService.instance.cancelAuthentication();
    await SessionService.instance.clearTokens();
    await StorageService.instance.clearIdentityOnLogout();
    
    // 🔄 FORCE RE-INIT: Reset flag so initialize can run again correctly
    _initialized = false;
    await initialize();
    
    await NotificationService().reset(); 
    notifyListeners();
  }

  // ── Private Helpers ──────────────────────────────────────

  void _setLoading(bool val) {
    isLoading = val;
    if (val) errorMessage = null;
    notifyListeners();
  }

  String _mapError(String e) {
    if (e.contains('Connection')) return 'لا يوجد اتصال بالسيرفر';
    if (e.contains('401')) return 'انتهت الجلسة، يرجى تسجيل الدخول';
    if (e.contains('timeout')) return 'استغرق الوقت طويل، حاول لاحقاً';
    return e.replaceAll('Exception: ', '');
  }

  @override
  void dispose() {
    _eventSubscription?.cancel();
    super.dispose();
  }
}

enum BiometricLoginStatus { success, failed, cancelled, lockedOut, sessionExpired }

class BiometricLoginResult {
  final BiometricLoginStatus status;
  final String? message;
  const BiometricLoginResult({required this.status, this.message});
  bool get isSuccess => status == BiometricLoginStatus.success;
}

