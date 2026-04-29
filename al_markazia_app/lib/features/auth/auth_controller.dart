import 'package:flutter/material.dart';
import '../../services/api/auth_api.dart';
import '../../services/session_service.dart';
import '../../services/storage_service.dart';
import '../../services/notification_service.dart';
import '../../services/biometric_service.dart';
import '../../services/api_service.dart';

enum AuthStatus { loading, authenticated, unauthenticated, biometricRequired, sessionExpired }

class AuthController extends ChangeNotifier {
  final AuthApi _api = AuthApi();

  AuthStatus _status = AuthStatus.loading;
  AuthStatus get status => _status;

  bool isLoading = false;
  String? errorMessage;

  /// 🛡️ Identity property (Derived from StorageService)
  Map<String, dynamic>? get user => StorageService.instance.getCurrentUser();

  // ── Biometric state ──
  bool _biometricAvailable = false;
  bool _biometricEnabled = false;

  bool get isBiometricAvailable => _biometricAvailable;
  bool get isBiometricEnabled => _biometricEnabled;

  AuthController() {
    initialize();
  }

  bool get isAuthenticated => status == AuthStatus.authenticated;

  /// 🧠 SYSTEM INITIALIZE (The Core Boot Logic)
  Future<void> initialize() async {
    _status = AuthStatus.loading;
    notifyListeners();

    try {
      final session = SessionService.instance;
      final storage = StorageService.instance;

      // 1. Check if we have active tokens
      if (await session.hasSession) {
        _status = AuthStatus.authenticated;
      } else {
        // 2. No session — check if biometrics are enabled and we have a user identity
        final hasIdentity = storage.userId != null;
        final biometricActive = storage.isBiometricEnabled;
        
        if (hasIdentity && biometricActive) {
          _status = AuthStatus.biometricRequired;
        } else {
          _status = AuthStatus.unauthenticated;
        }
      }
    } catch (e) {
      debugPrint('⚠️ Auth Init Error: $e');
      _status = AuthStatus.unauthenticated;
    }

    await _refreshBiometricState();
    notifyListeners();
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

  // ════════════════════════════════════════════════════════
  //  🔐 LOGIN (Email + Password)
  // ════════════════════════════════════════════════════════
  Future<bool> login(String email, String password) async {
    _setLoading(true);
    try {
      final authResponse = await ApiService.instance.loginCustomer(email, password);
      
      // 🛡️ Auto-update Biometric Token if enabled
      if (_biometricEnabled) {
        final rt = await SessionService.instance.refreshToken;
        if (rt != null) await SessionService.instance.saveBiometricToken(rt);
      }

      _status = AuthStatus.authenticated;
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
    final result = await BiometricService.instance.authenticate(reason: reason);

    if (!result.success) {
      if (result.isLockedOut) return BiometricLoginResult(status: BiometricLoginStatus.lockedOut, message: result.message);
      if (result.wasCancelled) return BiometricLoginResult(status: BiometricLoginStatus.cancelled);
      return BiometricLoginResult(status: BiometricLoginStatus.failed, message: result.message);
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
      NotificationService().reinitialize();
      _setLoading(false);
      return BiometricLoginResult(status: BiometricLoginStatus.success);
    } catch (e) {
      _setLoading(false);
      return BiometricLoginResult(status: BiometricLoginStatus.failed, message: 'فشل التحقق من الجلسة');
    }
  }

  // ════════════════════════════════════════════════════════
  //  🔐 BIOMETRIC PREFERENCE
  // ════════════════════════════════════════════════════════

  Future<bool> enableBiometrics({required String reason}) async {
    final result = await BiometricService.instance.authenticate(reason: reason);
    if (!result.success) return false;

    // 🛡️ Save the 'Hint' for future logins: current refreshToken
    final currentRefresh = await SessionService.instance.refreshToken;
    if (currentRefresh != null) {
      await SessionService.instance.saveBiometricToken(currentRefresh);
    }

    await StorageService.instance.setBiometricEnabled(true);
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
      // Update session & identity
      await SessionService.instance.saveTokens(
        accessToken: authResponse['accessToken'],
        refreshToken: authResponse['refreshToken'],
      );
      await StorageService.instance.setCurrentUser(authResponse['user']);
      
      // 🛡️ Auto-update Biometric Token if enabled
      if (_biometricEnabled) {
        final rt = await SessionService.instance.refreshToken;
        if (rt != null) await SessionService.instance.saveBiometricToken(rt);
      }

      _status = AuthStatus.authenticated;
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
      // Update session & identity
      await SessionService.instance.saveTokens(
        accessToken: authResponse['accessToken'],
        refreshToken: authResponse['refreshToken'],
      );
      await StorageService.instance.setCurrentUser(authResponse['user']);
      
      // 🛡️ Auto-update Biometric Token if enabled
      if (_biometricEnabled) {
        final rt = await SessionService.instance.refreshToken;
        if (rt != null) await SessionService.instance.saveBiometricToken(rt);
      }

      _status = AuthStatus.authenticated;
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
    
    // 🛡️ SECURITY UPGRADE:
    // We clear the session tokens (Security)
    await SessionService.instance.clearTokens();
    
    // We clear user-specific UI data (Identity Profile)
    await StorageService.instance.clearIdentityOnLogout();
    
    // ⚠️ WE KEEP: biometricsEnabled and user_email for next login!
    
    _status = AuthStatus.unauthenticated;
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
}

enum BiometricLoginStatus { success, failed, cancelled, lockedOut, sessionExpired }

class BiometricLoginResult {
  final BiometricLoginStatus status;
  final String? message;
  const BiometricLoginResult({required this.status, this.message});
  bool get isSuccess => status == BiometricLoginStatus.success;
}
