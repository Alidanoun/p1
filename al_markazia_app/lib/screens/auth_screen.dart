import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';
import '../features/auth/auth_controller.dart';
import '../widgets/custom_snackbar.dart';
import 'main_nav_screen.dart';
import '../services/notification_service.dart';
import '../utils/validators.dart';
import '../l10n/generated/app_localizations.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({Key? key}) : super(key: key);

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  
  final _loginFormKey = GlobalKey<FormState>();
  final _regFormKey = GlobalKey<FormState>();

  String loginEmail = '';
  String loginPassword = '';
  
  String regName = '';
  String regEmail = '';
  String regPassword = '';

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  void _goToHome() {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const MainNavScreen())
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    return Scaffold(
      backgroundColor: Colors.white,
      body: Stack(
        children: [
          // Background Color / Pattern
          Container(
            color: Theme.of(context).scaffoldBackgroundColor,
          ),
          
          // Orange Wavy Header
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: ClipPath(
              clipper: TopWaveClipper(),
              child: Container(
                height: MediaQuery.of(context).size.height * 0.45, // Slightly smaller than Welcome screen
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [Color(0xFFDCA965), Color(0xFFB8860B)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
                child: Stack(
                  children: [
                    // Textures
                    Positioned(
                      top: -50,
                      right: -30,
                      child: Container(
                        width: 150,
                        height: 150,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.white.withOpacity(0.1),
                        ),
                      ),
                    ),
                    Positioned(
                      top: 80,
                      left: -20,
                      child: Container(
                        width: 200,
                        height: 200,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white.withOpacity(0.05), width: 2),
                        ),
                      ),
                    ),
                  ],
                ),
              ).animate().fade(duration: 800.ms).slideY(begin: -0.2, end: 0, curve: Curves.easeOut),
            ),
          ),
          
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Logo Header
                    Container(
                      padding: const EdgeInsets.all(16),
                      margin: const EdgeInsets.only(bottom: 24),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.1),
                            blurRadius: 15,
                            spreadRadius: 3,
                            offset: const Offset(0, 8),
                          ),
                        ],
                      ),
                      child: const Icon(
                        Icons.restaurant_menu_rounded,
                        size: 40,
                        color: Color(0xFFFF6D00),
                      ),
                    ).animate().scale(delay: 200.ms, duration: 600.ms, curve: Curves.easeOutBack),
                    
                    Text(
                      AppLocalizations.of(context)!.loginTitle,
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                        shadows: [
                          Shadow(
                            color: Colors.black.withOpacity(0.2),
                            offset: const Offset(0, 2),
                            blurRadius: 4,
                          ),
                        ]
                      ),
                    ).animate().fade(delay: 400.ms).slideY(begin: -0.5, end: 0),
                    
                    const SizedBox(height: 32),
                    
                    // Form Card
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      child: Card(
                        elevation: 12,
                        shadowColor: Colors.black.withOpacity(0.15),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                        child: Padding(
                          padding: const EdgeInsets.all(20.0),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              TabBar(
                                controller: _tabController,
                                labelColor: const Color(0xFFFF6D00),
                                unselectedLabelColor: Colors.grey.shade400,
                                indicatorColor: const Color(0xFFFF6D00),
                                indicatorWeight: 3,
                                labelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                                tabs: [
                                  Tab(text: AppLocalizations.of(context)!.loginTab),
                                  Tab(text: AppLocalizations.of(context)!.registerTab),
                                ],
                              ),
                              const SizedBox(height: 24),
                              
                              SizedBox(
                                height: 350,
                                child: TabBarView(
                                  controller: _tabController,
                                  physics: const BouncingScrollPhysics(),
                                  children: [
                                    // Login Form
                                    Form(
                                      key: _loginFormKey,
                                      child: Column(
                                        mainAxisAlignment: MainAxisAlignment.center,
                                        children: [
                                          TextFormField(
                                            keyboardType: TextInputType.emailAddress,
                                            decoration: InputDecoration(
                                              labelText: AppLocalizations.of(context)!.email,
                                              prefixIcon: const Icon(Icons.email_rounded, color: Color(0xFFFF6D00)),
                                              filled: true,
                                              fillColor: Colors.grey.shade50,
                                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
                                            ),
                                            validator: (val) => Validators.validateEmail(val, AppLocalizations.of(context)!.required, AppLocalizations.of(context)!.required),
                                            onSaved: (val) => loginEmail = val!.trim(),
                                          ),
                                          const SizedBox(height: 16),
                                          TextFormField(
                                            obscureText: true,
                                            decoration: InputDecoration(
                                              labelText: AppLocalizations.of(context)!.password,
                                              prefixIcon: const Icon(Icons.lock_rounded, color: Color(0xFFFF6D00)),
                                              filled: true,
                                              fillColor: Colors.grey.shade50,
                                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
                                            ),
                                            validator: (val) => (val == null || val.length < 6) ? AppLocalizations.of(context)!.required : null,
                                            onSaved: (val) => loginPassword = val!,
                                          ),
                                          const SizedBox(height: 32),
                                          SizedBox(
                                            width: double.infinity,
                                            height: 56,
                                            child: ElevatedButton(
                                              onPressed: auth.isLoading
                                                  ? null
                                                  : () async {
                                                      if (_loginFormKey.currentState!.validate()) {
                                                        _loginFormKey.currentState!.save();
                                                        final success = await context.read<AuthController>().login(loginEmail, loginPassword);
                                                        if (success) {
                                                          if (mounted) {
                                                            NotificationService().init();
                                                            showCustomSnackbar(context, AppLocalizations.of(context)!.loginSuccessMsg);
                                                            _goToHome();
                                                          }
                                                        } else {
                                                          if (mounted) {
                                                            showCustomSnackbar(context, auth.errorMessage ?? "Error", isSuccess: false);
                                                          }
                                                        }
                                                      } else {
                                                        showCustomSnackbar(context, AppLocalizations.of(context)!.fieldsReviewMsg, isSuccess: false);
                                                      }
                                                    },
                                              style: ElevatedButton.styleFrom(
                                                backgroundColor: const Color(0xFFFF6D00),
                                                foregroundColor: Colors.white,
                                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                                                elevation: 8,
                                                shadowColor: const Color(0xFFFF6D00).withOpacity(0.5),
                                              ),
                                              child: auth.isLoading 
                                                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                                                : Text(AppLocalizations.of(context)!.loginTab, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    
                                    // Register Form
                                    Form(
                                      key: _regFormKey,
                                      child: SingleChildScrollView(
                                        child: Column(
                                          mainAxisAlignment: MainAxisAlignment.center,
                                          children: [
                                            TextFormField(
                                              decoration: InputDecoration(
                                                labelText: AppLocalizations.of(context)!.fullNameLabel,
                                                prefixIcon: const Icon(Icons.person_rounded, color: Color(0xFFFF6D00)),
                                                filled: true,
                                                fillColor: Colors.grey.shade50,
                                                border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
                                              ),
                                              validator: (val) => Validators.validateName(val, AppLocalizations.of(context)!.required, AppLocalizations.of(context)!.required),
                                              onSaved: (val) => regName = val!,
                                            ),
                                            const SizedBox(height: 16),
                                            TextFormField(
                                              keyboardType: TextInputType.emailAddress,
                                              decoration: InputDecoration(
                                                labelText: AppLocalizations.of(context)!.email,
                                                prefixIcon: const Icon(Icons.email_rounded, color: Color(0xFFFF6D00)),
                                                filled: true,
                                                fillColor: Colors.grey.shade50,
                                                border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
                                              ),
                                              validator: (val) => Validators.validateEmail(val, AppLocalizations.of(context)!.required, AppLocalizations.of(context)!.required),
                                              onSaved: (val) => regEmail = val!.trim(),
                                            ),
                                            const SizedBox(height: 16),
                                            TextFormField(
                                              obscureText: true,
                                              decoration: InputDecoration(
                                                labelText: AppLocalizations.of(context)!.password,
                                                prefixIcon: const Icon(Icons.lock_rounded, color: Color(0xFFFF6D00)),
                                                filled: true,
                                                fillColor: Colors.grey.shade50,
                                                border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
                                              ),
                                              validator: (val) => (val == null || val.length < 6) ? AppLocalizations.of(context)!.required : null,
                                              onSaved: (val) => regPassword = val!,
                                            ),
                                            const SizedBox(height: 32),
                                            SizedBox(
                                              width: double.infinity,
                                              height: 56,
                                              child: ElevatedButton(
                                                onPressed: auth.isLoading
                                                    ? null
                                                    : () async {
                                                        if (_regFormKey.currentState!.validate()) {
                                                          _regFormKey.currentState!.save();
                                                          final success = await context.read<AuthController>().register(regName, regEmail, regPassword);
                                                          if (success) {
                                                            if (mounted) {
                                                              _showOtpDialog(context, regEmail);
                                                            }
                                                          } else {
                                                            if (mounted) {
                                                              showCustomSnackbar(context, auth.errorMessage ?? "Error", isSuccess: false);
                                                            }
                                                          }
                                                        } else {
                                                          showCustomSnackbar(context, AppLocalizations.of(context)!.allFieldsRequiredMsg, isSuccess: false);
                                                        }
                                                      },
                                                style: ElevatedButton.styleFrom(
                                                  backgroundColor: const Color(0xFFFF6D00),
                                                  foregroundColor: Colors.white,
                                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                                                  elevation: 8,
                                                  shadowColor: const Color(0xFFFF6D00).withOpacity(0.5),
                                                ),
                                                child: auth.isLoading
                                                  ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                                                  : Text(AppLocalizations.of(context)!.registerAction, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ).animate().fade(delay: 600.ms).slideY(begin: 0.2, end: 0, curve: Curves.easeOutBack),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _showOtpDialog(BuildContext context, String email) {
    final codeController = TextEditingController();
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => Consumer<AuthController>(
        builder: (context, auth, _) => AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: const Text('كود التحقق', textAlign: TextAlign.center),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('يرجى إدخال الكود المرسل لبريدك الإلكتروني'),
              const SizedBox(height: 16),
              TextField(
                controller: codeController,
                keyboardType: TextInputType.number,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 24, letterSpacing: 8, fontWeight: FontWeight.bold),
                maxLength: 6,
                decoration: InputDecoration(
                  counterText: "",
                  filled: true,
                  fillColor: Colors.grey.shade100,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                ),
              ),
              if (auth.errorMessage != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8.0),
                  child: Text(auth.errorMessage!, style: const TextStyle(color: Colors.red, fontSize: 12)),
                ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('إلغاء'),
            ),
            ElevatedButton(
              onPressed: auth.isLoading ? null : () async {
                final success = await auth.verifyOtp(email, codeController.text);
                if (success && context.mounted) {
                  Navigator.pop(context);
                  _goToHome();
                }
              },
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFF6D00), foregroundColor: Colors.white),
              child: auth.isLoading 
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                : const Text('تأكيد'),
            ),
          ],
        ),
      ),
    );
  }
}

// Custom Clipper for the Wavy Header (reused from WelcomeScreen, but placed here since files are separate)
class TopWaveClipper extends CustomClipper<Path> {
  @override
  Path getClip(Size size) {
    var path = Path();
    path.lineTo(0, size.height - 80);
    
    var firstControlPoint = Offset(size.width / 4, size.height);
    var firstEndPoint = Offset(size.width / 2.25, size.height - 30);
    path.quadraticBezierTo(
      firstControlPoint.dx, firstControlPoint.dy, 
      firstEndPoint.dx, firstEndPoint.dy
    );
    
    var secondControlPoint = Offset(size.width - (size.width / 3.25), size.height - 90);
    var secondEndPoint = Offset(size.width, size.height - 40);
    path.quadraticBezierTo(
      secondControlPoint.dx, secondControlPoint.dy, 
      secondEndPoint.dx, secondEndPoint.dy
    );
    
    path.lineTo(size.width, 0);
    path.close();
    return path;
  }

  @override
  bool shouldReclip(CustomClipper<Path> oldClipper) => false;
}
