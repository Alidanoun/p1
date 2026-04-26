import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter/foundation.dart';

class BiometricService {
  static const String _biometricEnabledKey = 'biometric_enabled';

  static final BiometricService instance = BiometricService._internal();
  BiometricService._internal();

  final LocalAuthentication _localAuth = LocalAuthentication();
  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();

  // ── Capability Checks ──────────────────────────────────

  /// Returns true if the device hardware supports biometrics
  /// AND the user has enrolled at least one biometric.
  Future<bool> get isAvailable async {
    try {
      final canCheck = await _localAuth.canCheckBiometrics;
      final isDeviceSupported = await _localAuth.isDeviceSupported();
      if (!canCheck || !isDeviceSupported) return false;

      final enrolled = await _localAuth.getAvailableBiometrics();
      return enrolled.isNotEmpty;
    } on PlatformException catch (e) {
      debugPrint('BiometricService: isAvailable check failed — ${e.message}');
      return false;
    }
  }

  /// Returns a human-readable description of available biometrics
  /// e.g., "بصمة الإصبع", "Face ID", "بصمة الإصبع أو Face ID"
  Future<String> get availableTypesLabel async {
    try {
      final types = await _localAuth.getAvailableBiometrics();
      final hasFace = types.contains(BiometricType.face);
      final hasFinger = types.contains(BiometricType.fingerprint);
      final hasIris = types.contains(BiometricType.iris);

      if (hasFace && hasFinger) return 'بصمة الإصبع أو Face ID';
      if (hasFace) return 'Face ID';
      if (hasFinger) return 'بصمة الإصبع';
      if (hasIris) return 'بصمة العين';
      return 'البصمة';
    } catch (_) {
      return 'البصمة';
    }
  }

  // ── User Preference ────────────────────────────────────

  /// Returns true if the user has opted in to biometric login
  Future<bool> get isEnabled async {
    final val = await _secureStorage.read(key: _biometricEnabledKey);
    return val == 'true';
  }

  /// Enable biometric login (called after successful password login)
  Future<void> enable() async {
    await _secureStorage.write(key: _biometricEnabledKey, value: 'true');
    debugPrint('BiometricService: enabled');
  }

  /// Disable biometric login (called on logout or user preference)
  Future<void> disable() async {
    await _secureStorage.write(key: _biometricEnabledKey, value: 'false');
    debugPrint('BiometricService: disabled');
  }

  // ── Authentication ─────────────────────────────────────

  /// Prompts the user for biometric verification.
  ///
  /// Returns [BiometricResult] with status and optional error.
  /// Does NOT perform any network request — the caller handles
  /// what happens after (usually: trigger token refresh).
  Future<BiometricResult> authenticate({
    String reason = 'ادخل بصمتك للدخول بسرعة',
  }) async {
    // Guard: check availability first
    if (!await isAvailable) {
      return BiometricResult(
        success: false,
        error: BiometricError.notAvailable,
        message: 'جهازك لا يدعم المقاييس الحيوية أو لم يتم تسجيلها',
      );
    }

    try {
      final authenticated = await _localAuth.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(
          stickyAuth: true,      // Keep prompt alive if user switches apps
          biometricOnly: true,   // Disallow PIN/password fallback in the biometric prompt
          sensitiveTransaction: false,
        ),
      );

      if (authenticated) {
        debugPrint('BiometricService: authentication succeeded');
        return BiometricResult(success: true);
      } else {
        return BiometricResult(
          success: false,
          error: BiometricError.cancelled,
          message: 'تم إلغاء التحقق',
        );
      }
    } on PlatformException catch (e) {
      debugPrint('BiometricService: PlatformException — ${e.code}: ${e.message}');

      // Map platform error codes to friendly messages
      final BiometricError errType;
      final String msg;

      switch (e.code) {
        case 'NotEnrolled':
        case 'no_biometrics_enrolled':
          errType = BiometricError.notEnrolled;
          msg = 'لم يتم تسجيل أي بصمة على هذا الجهاز';
          break;
        case 'LockedOut':
        case 'PermanentlyLockedOut':
          errType = BiometricError.lockedOut;
          msg = 'تم تجميد البصمة بسبب محاولات فاشلة. ادخل بكلمة المرور';
          break;
        case 'UserCancel':
        case 'passcode_not_set':
          errType = BiometricError.cancelled;
          msg = 'تم إلغاء التحقق';
          break;
        default:
          errType = BiometricError.unknown;
          msg = 'فشل التحقق بالمقاييس الحيوية';
      }

      return BiometricResult(success: false, error: errType, message: msg);
    }
  }

  /// Cancel any ongoing biometric prompt (e.g., on app background)
  Future<void> cancelAuthentication() async {
    try {
      await _localAuth.stopAuthentication();
    } catch (_) {}
  }
}

// ── Result Model ───────────────────────────────────────────

enum BiometricError {
  notAvailable,
  notEnrolled,
  lockedOut,
  cancelled,
  unknown,
}

class BiometricResult {
  final bool success;
  final BiometricError? error;
  final String? message;

  const BiometricResult({
    required this.success,
    this.error,
    this.message,
  });

  /// True if failure was due to lockout — suggest password login
  bool get isLockedOut => error == BiometricError.lockedOut;

  /// True if failure was user-initiated cancel (not an error)
  bool get wasCancelled => error == BiometricError.cancelled;
}
