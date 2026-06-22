// File generated for Al Markazia App to support platform-specific Firebase configuration.
// ignore_for_file: type=lint
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

/// Default [FirebaseOptions] for use with your Firebase apps.
///
/// Example:
/// ```dart
/// import 'firebase_options.dart';
/// // ...
/// await Firebase.initializeApp(
///   options: DefaultFirebaseOptions.currentPlatform,
/// );
/// ```
class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      return web;
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      case TargetPlatform.macOS:
        return macos;
      case TargetPlatform.windows:
        return windows;
      case TargetPlatform.linux:
        throw UnsupportedError(
          'DefaultFirebaseOptions have not been configured for linux.',
        );
      default:
        throw UnsupportedError(
          'DefaultFirebaseOptions are not supported for this platform.',
        );
    }
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyA2plck1m4A4WYHsh45hwJf-a867MEWQHM',
    appId: '1:171715735166:android:fcdba856e305cfe0be722f',
    messagingSenderId: '171715735166',
    projectId: 'al-markazia-app',
    storageBucket: 'al-markazia-app.firebasestorage.app',
  );
  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyCT6z7HR1HU_mn3NYO8mvxPf3vBhPRlm0Y',
    appId: '1:171715735166:web:09da8448ace71939be722f',
    messagingSenderId: '171715735166',
    projectId: 'al-markazia-app',
    authDomain: 'al-markazia-app.firebaseapp.com',
    storageBucket: 'al-markazia-app.firebasestorage.app',
    measurementId: 'G-GV0880DVE9',
  );

  static const FirebaseOptions macos = FirebaseOptions(
    apiKey: 'AIzaSyDrEIYfkhixp0-2-4gGssVLbJqyaHYhfwQ',
    appId: '1:171715735166:ios:fbe25cc1d63a2b60be722f',
    messagingSenderId: '171715735166',
    projectId: 'al-markazia-app',
    storageBucket: 'al-markazia-app.firebasestorage.app',
    iosBundleId: 'com.example.alMarkaziaApp',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyDrEIYfkhixp0-2-4gGssVLbJqyaHYhfwQ',
    appId: '1:171715735166:ios:fbe25cc1d63a2b60be722f',
    messagingSenderId: '171715735166',
    projectId: 'al-markazia-app',
    storageBucket: 'al-markazia-app.firebasestorage.app',
    iosBundleId: 'com.example.alMarkaziaApp',
  );

  static const FirebaseOptions windows = FirebaseOptions(
    apiKey: 'AIzaSyCT6z7HR1HU_mn3NYO8mvxPf3vBhPRlm0Y',
    appId: '1:171715735166:web:d69b193ca91e2c69be722f',
    messagingSenderId: '171715735166',
    projectId: 'al-markazia-app',
    authDomain: 'al-markazia-app.firebaseapp.com',
    storageBucket: 'al-markazia-app.firebasestorage.app',
    measurementId: 'G-G4E7X20ZET',
  );
}
