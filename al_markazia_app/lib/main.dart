import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'theme/app_theme.dart';
import 'services/storage_service.dart';
import 'services/notification_service.dart';
import 'screens/auth_screen.dart';
import 'screens/video_splash_screen.dart'; // Added for video splash
import 'screens/main_nav_screen.dart';
import 'services/api_service.dart';
import 'package:provider/provider.dart';
import 'features/auth/auth_controller.dart';
import 'features/orders/order_controller.dart';
import 'features/cart/cart_controller.dart';
import 'features/checkout/checkout_controller.dart';
import 'services/session_service.dart';
import 'services/secure_client.dart';

import 'l10n/generated/app_localizations.dart';

@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  debugPrint("🛰️ Handling background message: ${message.messageId}");
  
  // 🛡️ Show local notification for data-only messages in background
  // For hybrid payloads (notification + data), Android OS handles the display automatically.
  // This ensures data-only messages also create visible notifications.
  if (message.notification == null && message.data.isNotEmpty) {
    final plugin = FlutterLocalNotificationsPlugin();
    await plugin.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      ),
    );
    
    final title = message.data['title'] ?? 'Al Markazia';
    final body = message.data['message'] ?? message.data['body'] ?? '';
    
    await plugin.show(
      message.hashCode,
      title,
      body,
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'almarkazia_channel',
          'Al Markazia Notifications',
          importance: Importance.max,
          priority: Priority.high,
          playSound: true,
          enableVibration: true,
        ),
      ),
    );
  }
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  
  // 🛡️ Register Background Handler before any other async work
  FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

  // Essential fast inits
  await StorageService.instance.init();
  await SessionService.instance.init();
  await initSecurePinning();
  
  // [V5 Priority 2] Early Notification Channel Creation
  await NotificationService.createNotificationChannel();

  // 🛡️ Android 13+ (API 33): Request notification permission early
  final messaging = FirebaseMessaging.instance;
  await messaging.requestPermission(
    alert: true,
    badge: true,
    sound: true,
    criticalAlert: true,
  );

  // 🛡️ Ensure foreground notifications display on iOS
  await messaging.setForegroundNotificationPresentationOptions(
    alert: true,
    badge: true,
    sound: true,
  );

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthController()),
        ChangeNotifierProvider(create: (_) => OrderController()),
        ChangeNotifierProvider(create: (_) => CartController()),
        ChangeNotifierProvider(create: (_) => CheckoutController()),
      ],
      child: const MarkaziaApp(),
    ),
  );
}

final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

class MarkaziaApp extends StatefulWidget {
  const MarkaziaApp({Key? key}) : super(key: key);

  @override
  State<MarkaziaApp> createState() => _MarkaziaAppState();
}

class _MarkaziaAppState extends State<MarkaziaApp> {
  bool _isDarkMode = false;
  String _langCode = 'ar';

  @override
  void initState() {
    super.initState();
    _isDarkMode = StorageService.instance.getDarkMode();
    _langCode = StorageService.instance.getLanguageCode();

    StorageService.instance.addListener(() {
      if (mounted) {
        setState(() {
          _isDarkMode = StorageService.instance.getDarkMode();
          _langCode = StorageService.instance.getLanguageCode();
        });
      }
    });

    final user = StorageService.instance.getCurrentUser();
    NotificationService().init();

    ApiService.onAuthError = () async {
      debugPrint('🚪 Auth Error Bridge Triggered - Force Logout');
      
      // We use the static instance logic because this callback is static
      await SessionService.instance.clearTokens();
      await StorageService.instance.clearIdentityOnLogout();
      
      // 2. Clear Notification Identity
      NotificationService().reset();
      
      // 3. Force Navigation to Auth Screen
      if (navigatorKey.currentState != null) {
        navigatorKey.currentState!.pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const AuthScreen()),
          (route) => false,
        );
      }
    };
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: navigatorKey,
      title: 'Al Markazia',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: _isDarkMode ? ThemeMode.dark : ThemeMode.light,
      
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      locale: Locale(_langCode),
      
      home: const VideoSplashScreen(),
    );
  }
}
