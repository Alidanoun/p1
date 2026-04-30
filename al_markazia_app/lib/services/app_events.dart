import 'dart:async';

/// 🎯 Enterprise Event Bus
/// Decouples services by providing a central stream for global application events.
class AppEvents {
  static final _controller = StreamController<AppEvent>.broadcast();

  /// The main event stream
  static Stream<AppEvent> get stream => _controller.stream;

  /// Emit a new event
  static void emit(AppEvent event) => _controller.add(event);

  /// Dispose (Not usually needed for a global singleton, but good for testing)
  static void dispose() => _controller.close();
}

/// 🧩 Application Event Types
abstract class AppEvent {}

/// Triggered when the user session has completely failed (Final 401)
class SessionExpiredEvent extends AppEvent {}

/// Triggered after a successful login
class LoginSuccessEvent extends AppEvent {
  final Map<String, dynamic> user;
  LoginSuccessEvent(this.user);
}

/// Triggered when the app needs to force a UI reset (e.g., Logout)
class LogoutEvent extends AppEvent {}

/// Triggered when the restaurant status changes
class RestaurantStatusChangedEvent extends AppEvent {
  final bool isOpen;
  RestaurantStatusChangedEvent(this.isOpen);
}

/// Triggered when the user profile data needs refreshing (e.g., points awarded)
class IdentityRefreshEvent extends AppEvent {}
