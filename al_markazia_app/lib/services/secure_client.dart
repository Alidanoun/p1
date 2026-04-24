import 'dart:io';
import 'package:flutter/services.dart' show rootBundle;

class SecureHttpOverrides extends HttpOverrides {
  final List<int> certBytes;
  
  SecureHttpOverrides(this.certBytes);

  @override
  HttpClient createHttpClient(SecurityContext? context) {
    final secureContext = SecurityContext(withTrustedRoots: false);
    secureContext.setTrustedCertificatesBytes(certBytes);
    return super.createHttpClient(secureContext);
  }
}

/// Call this before runApp()
Future<void> initSecurePinning() async {
  try {
    final cert = await rootBundle.load('assets/certificates/server.crt');
    HttpOverrides.global = SecureHttpOverrides(cert.buffer.asUint8List());
  } catch (e) {
    // Certificate not found or failed to load.
    // In production, this should throw. For dev, we might fallback.
    print('Warning: server.crt not found in assets. SSL Pinning disabled.');
  }
}
