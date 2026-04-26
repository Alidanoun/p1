import 'package:flutter/material.dart';
import '../../services/api/auth_api.dart';
import '../../services/session_service.dart';
import '../../services/storage_service.dart';
import '../../services/notification_service.dart';
import '../../services/biometric_service.dart';
import '../../services/api_service.dart';

class AuthController extends ChangeNotifier {
  final AuthApi _api = AuthApi();

  bool isLoading = false;
  String? errorMessage;

  /// 🛡️ The 'Golden Record' of the current user session
  Map<String, dynamic>? user;

  // ── Biometric state ──
  bool _biometricAvailable = false;
  bool _biometricEnabled = false;

  bool get isBiometricAvailable => _biometricAvailable;
  bool get isBiometricEnabled => _biometricEnabled;

  AuthController() {
    _initSession();
  }

  bool get isAuthenticated => user != null && user!['id'] != null;

  /// 🧠 System-level initialization
  Future<void> _initSession() async {
    await restoreSession();
    await _refreshBiometricState();
  }

  Future<void> _refreshBiometricState() async {
    _biometricAvailable = await BiometricService.instance.isAvailable;
    final hasToken = await SessionService.instance.refreshToken != null;
    _biometricEnabled = (await BiometricService.instance.isEnabled) && hasToken;
    notifyListeners();
  }

  /// 🚀 Smart Session Restoration
  Future<Map<String, dynamic>?> restoreSession() async {
    final session = SessionService.instance;
    if (await session.isLoggedIn) {
      user ??= {
        'id': session.uuid,
        'name': session.name,
        'role': session.role,
        'phone': session.phone,
      };
      notifyListeners();
      return user;
    }
    return user;
  }

  // ════════════════════════════════════════════════════════
  //  🔐 LOGIN (Email + Password)
  // ════════════════════════════════════════════════════════
  Future<bool> login(String email, String password) async {
    _setLoading(true);
    try {
      final authResponse = await _api.loginCustomer(email, password);
      await _saveSession(authResponse);
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
  /// Fast biometric re-authentication.
  Future<BiometricLoginResult> loginWithBiometrics({required String reason}) async {
    // 1. Verify biometric
    final result = await BiometricService.instance.authenticate(
      reason: reason,
    );

    if (!result.success) {
      if (result.isLockedOut) {
        return BiometricLoginResult(
          status: BiometricLoginStatus.lockedOut,
          message: result.message ?? 'تم تجميد البصمة',
        );
      }
      if (result.wasCancelled) {
        return BiometricLoginResult(status: BiometricLoginStatus.cancelled);
      }
      return BiometricLoginResult(
        status: BiometricLoginStatus.failed,
        message: result.message ?? 'فشل التحقق',
      );
    }

    // 2. Biometric approved — use stored refresh token via ApiService silent refresh
    _setLoading(true);
    try {
      final newAccessToken = await ApiService.instance.refreshTokens();

      if (newAccessToken == null) {
        _setLoading(false);
        return BiometricLoginResult(
          status: BiometricLoginStatus.sessionExpired,
          message: 'انتهت صلاحية الجلسة، يرجى الدخول بكلمة المرور',
        );
      }

      user = {
        'id': SessionService.instance.uuid,
        'name': SessionService.instance.name,
        'role': SessionService.instance.role,
        'phone': SessionService.instance.phone,
      };

      NotificationService().init();
      _setLoading(false);
      return BiometricLoginResult(status: BiometricLoginStatus.success);
    } catch (e) {
      _setLoading(false);
      return BiometricLoginResult(
        status: BiometricLoginStatus.failed,
        message: 'فشل التحقق من الجلسة',
      );
    }
  }

  // ════════════════════════════════════════════════════════
  //  🔐 BIOMETRIC PREFERENCE
  // ════════════════════════════════════════════════════════

  Future<bool> enableBiometrics({required String reason}) async {
    final result = await BiometricService.instance.authenticate(
      reason: reason,
    );
    if (!result.success) return false;

    await BiometricService.instance.enable();
    _biometricEnabled = true;
    notifyListeners();
    return true;
  }

  Future<void> disableBiometrics() async {
    await BiometricService.instance.disable();
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
      await _api.registerCustomer(
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
      await _saveSession(authResponse);
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
      await _saveSession(authResponse);
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
    await BiometricService.instance.disable(); // 🔥 Reset biometric preference on logout
    await SessionService.instance.clearSession();
    await StorageService.instance.setCurrentUser(null);
    user = null;
    notifyListeners();
  }

  // ── Private Helpers ──────────────────────────────────────

  Future<void> _saveSession(Map<String, dynamic> authResponse) async {
    await SessionService.instance.saveUser(authResponse);
    await StorageService.instance.setCurrentUser(authResponse['user']);
    user = authResponse['user'];
    NotificationService().init();
    _setLoading(false);
    notifyListeners();
  }

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
