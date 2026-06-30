/// 🛡️ Enterprise Unified Exception System
/// Replaces raw Exception(string) with typed, actionable error models.
/// The UI layer can use pattern matching to display the correct message/action.
library app_exception;

// ─────────────────────────────────────────────
//  Base
// ─────────────────────────────────────────────

/// Base class for all application-level exceptions.
sealed class AppException implements Exception {
  final String message;

  /// Optional machine-readable code from the backend (e.g. 'TOKEN_EXPIRED').
  final String? code;

  const AppException(this.message, {this.code});

  @override
  String toString() => 'AppException($runtimeType): $message${code != null ? ' [$code]' : ''}';
}

// ─────────────────────────────────────────────
//  Network Layer Errors
// ─────────────────────────────────────────────

/// Thrown when there is no internet connection or the request times out.
/// Safe to retry after connectivity is restored.
class NetworkException extends AppException {
  const NetworkException([super.message = 'لا يوجد اتصال بالإنترنت. يرجى التحقق من الشبكة.'])
      : super.new(code: 'NETWORK_ERROR');
}

/// Thrown when a request exceeds its configured timeout duration.
class TimeoutException extends AppException {
  const TimeoutException([super.message = 'انتهت مهلة الطلب. يرجى المحاولة مجدداً.'])
      : super.new(code: 'TIMEOUT');
}

// ─────────────────────────────────────────────
//  Auth Errors (4xx identity layer)
// ─────────────────────────────────────────────

/// Thrown when the server returns 401 and the token refresh cycle has failed.
/// The app should redirect to the login screen.
class AuthException extends AppException {
  const AuthException([
    super.message = 'انتهت جلستك. يرجى تسجيل الدخول مجدداً.',
    String? code,
  ]) : super.new(code: code ?? 'AUTH_FAILED');
}

/// Thrown when the server returns 403 (authenticated but not authorized).
class ForbiddenException extends AppException {
  const ForbiddenException([super.message = 'ليس لديك صلاحية للقيام بهذا الإجراء.'])
      : super.new(code: 'FORBIDDEN');
}

// ─────────────────────────────────────────────
//  Client Errors (4xx business logic layer)
// ─────────────────────────────────────────────

/// Thrown when the server returns 422 or a business-rule violation.
/// Contains the user-friendly message from the backend.
class ValidationException extends AppException {
  const ValidationException(super.message, {String? code})
      : super.new(code: code ?? 'VALIDATION_ERROR');
}

/// Thrown when the server returns 409 (e.g. price changed, stock depleted).
class ConflictException extends AppException {
  const ConflictException(super.message, {String? code})
      : super.new(code: code ?? 'CONFLICT');
}

/// Thrown when the server returns 404.
class NotFoundException extends AppException {
  const NotFoundException([super.message = 'العنصر المطلوب غير موجود.'])
      : super.new(code: 'NOT_FOUND');
}

/// Thrown when rate-limiting is hit (429).
class RateLimitException extends AppException {
  const RateLimitException([super.message = 'محاولات كثيرة. يرجى الانتظار قليلاً.'])
      : super.new(code: 'RATE_LIMITED');
}

// ─────────────────────────────────────────────
//  Server Errors (5xx)
// ─────────────────────────────────────────────

/// Thrown when the server returns 5xx.
/// The user should be informed and can retry later.
class ServerException extends AppException {
  final int? statusCode;
  const ServerException([
    super.message = 'حدث خطأ في الخادم. يرجى المحاولة لاحقاً.',
    this.statusCode,
    String? code,
  ]) : super.new(code: code ?? 'SERVER_ERROR');
}

// ─────────────────────────────────────────────
//  Parsing / Unknown
// ─────────────────────────────────────────────

/// Thrown when the response body cannot be parsed.
class ParseException extends AppException {
  const ParseException([super.message = 'تعذّر معالجة استجابة الخادم.'])
      : super.new(code: 'PARSE_ERROR');
}

/// Catch-all for truly unexpected errors.
class UnknownException extends AppException {
  const UnknownException([super.message = 'حدث خطأ غير متوقع.'])
      : super.new(code: 'UNKNOWN');
}

// ─────────────────────────────────────────────
//  Factory — parse raw HTTP responses
// ─────────────────────────────────────────────

/// Maps an HTTP status code + optional JSON body to the correct [AppException].
AppException appExceptionFromHttp(int statusCode, Map<String, dynamic>? body) {
  final serverCode = body?['error'] is Map
      ? (body!['error'] as Map)['code']?.toString()
      : null;
  final serverMessage = _extractMessage(body);

  return switch (statusCode) {
    401 => AuthException(serverMessage ?? 'انتهت جلستك.', serverCode),
    403 => ForbiddenException(serverMessage ?? 'ليس لديك صلاحية.'),
    404 => NotFoundException(serverMessage ?? 'العنصر غير موجود.'),
    409 => ConflictException(serverMessage ?? 'تعارض في البيانات.', code: serverCode),
    422 => ValidationException(serverMessage ?? 'بيانات غير صالحة.', code: serverCode),
    429 => RateLimitException(serverMessage ?? 'محاولات كثيرة.'),
    >= 500 => ServerException(serverMessage ?? 'خطأ في الخادم.', statusCode, serverCode),
    _ => ValidationException(serverMessage ?? 'طلب غير صالح.'),
  };
}

/// Extracts a human-readable message from the enterprise error envelope.
String? _extractMessage(Map<String, dynamic>? body) {
  if (body == null) return null;
  final error = body['error'];
  if (error is Map) return error['message']?.toString();
  if (error is String) return error;
  return body['message']?.toString();
}
