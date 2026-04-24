import 'package:flutter/material.dart';
import '../../services/api/auth_api.dart';
import '../../services/session_service.dart';
import '../../services/storage_service.dart';
import '../../services/notification_service.dart';

class AuthController extends ChangeNotifier {
  final AuthApi _api = AuthApi();

  bool isLoading = false;
  String? errorMessage;

  /// 🛡️ The 'Golden Record' of the current user session
  Map<String, dynamic>? user;

  AuthController() {
    _initSession();
  }

  /// 🧠 Identity Source of Truth
  /// Checks if a valid identity exists in the current state
  bool get isAuthenticated => user != null && user!['id'] != null;

  /// 🧠 System-level initialization
  Future<void> _initSession() async {
    await restoreSession();
  }

  /// 🚀 Smart Session Restoration (Enterprise JWT Support)
  Future<Map<String, dynamic>?> restoreSession() async {
    final session = SessionService.instance;
    
    // Check if we have a secure session
    if (await session.isLoggedIn) {
      // 1. Fast Load (Cache from Prefs)
      user ??= {
        'id': session.uuid,
        'name': session.name,
        'role': session.role,
      };
      notifyListeners();

      // 2. Background Refresh / Verification
      try {
        // We use the uuid to fetch the latest profile if needed
        // For now, if we have a valid token (isLoggedIn checked it), we are good.
        // The ApiService will handle token refresh automatically on first request.
        return user;
      } catch (e) {
        debugPrint('Session verification failed: $e');
      }
    }
    return user;
  }

  // 🔐 LOGIN (Enterprise Flow)
  Future<bool> login(String email, String password) async {
    isLoading = true;
    errorMessage = null;
    notifyListeners();

    try {
      // Step 1: Auth (Returns {accessToken, refreshToken, user})
      final authResponse = await _api.loginCustomer(email, password);
      
      // Step 2: Save to Secure Storage
      await SessionService.instance.saveUser(authResponse);
      
      // Step 3: Legacy Sync (optional, for other parts of app)
      await StorageService.instance.setCurrentUser(authResponse['user']);
      
      // Step 4: Update Local State
      user = authResponse['user'];
      // Ensure local state uses UUID as ID
      user!['id'] = authResponse['user']['id']; 

      // Step 5: Sync Real-time & Push Identity
      NotificationService().init();

      isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      errorMessage = _mapError(e.toString());
      isLoading = false;
      notifyListeners();
      return false;
    }
  }

  // 📝 REGISTER (Phase 1: Request OTP)
  Future<bool> register(String name, String email, String password) async {
    isLoading = true;
    errorMessage = null;
    notifyListeners();

    try {
      await _api.registerCustomer(name, email, password);
      isLoading = false;
      notifyListeners();
      return true; // Success means OTP was sent
    } catch (e) {
      errorMessage = _mapError(e.toString());
      isLoading = false;
      notifyListeners();
      return false;
    }
  }

  // ✅ VERIFY OTP (Phase 2: Complete Registration)
  Future<bool> verifyOtp(String email, String code) async {
    isLoading = true;
    errorMessage = null;
    notifyListeners();

    try {
      final authResponse = await _api.verifyRegistration(email, code);
      await SessionService.instance.saveUser(authResponse);
      await StorageService.instance.setCurrentUser(authResponse['user']);
      user = authResponse['user'];
      
      NotificationService().init();
      
      isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      errorMessage = _mapError(e.toString());
      isLoading = false;
      notifyListeners();
      return false;
    }
  }

  // 🚪 LOGOUT (Enterprise Cleanup)
  Future<void> logout() async {
    // 1. Clear all session layers (Secure + Legacy)
    await SessionService.instance.clearSession();
    await StorageService.instance.setCurrentUser(null);
    
    // 2. Clear UI State
    user = null;
    notifyListeners();
  }

  // 🧠 ERROR MAPPING
  String _mapError(String e) {
    if (e.contains('Connection')) return "لا يوجد اتصال بالسيرفر";
    if (e.contains('401')) return "انتهت الجلسة، يرجى تسجيل الدخول";
    if (e.contains('timeout')) return "استغرق الوقت طويل، حاول لاحقاً";
    return e.replaceAll('Exception: ', '');
  }
}
