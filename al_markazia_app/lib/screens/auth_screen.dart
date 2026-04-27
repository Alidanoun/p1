import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';
import '../features/auth/auth_controller.dart';
import '../widgets/custom_snackbar.dart';
import 'main_nav_screen.dart';
import '../utils/validators.dart';
import '../l10n/generated/app_localizations.dart';
import '../services/biometric_service.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({Key? key}) : super(key: key);

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  final _loginFormKey = GlobalKey<FormState>();
  final _regFormKey = GlobalKey<FormState>();

  String loginEmail = '';
  String loginPassword = '';
  String regName = '';
  String regEmail = '';
  String regPassword = '';
  String regPhone = '';

  bool _loginPasswordVisible = false;
  bool _regPasswordVisible = false;
  int _biometricFailCount = 0; // 🔥 Track failures for fallback

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _checkBiometricAutoPrompt();
  }

  /// If biometric is enabled and we have a valid session, auto-prompt on open
  Future<void> _checkBiometricAutoPrompt() async {
    final auth = context.read<AuthController>();
    if (auth.isBiometricEnabled && !auth.isAuthenticated) {
      await Future.delayed(const Duration(milliseconds: 600));
      if (mounted) _triggerBiometricLogin();
    }
  }

  void _goToHome() {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const MainNavScreen()),
    );
  }

  // ════════════════════════════════════════════════════════
  //  Biometric Login
  // ════════════════════════════════════════════════════════
  Future<void> _triggerBiometricLogin() async {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.read<AuthController>();
    final result = await auth.loginWithBiometrics(reason: l10n.biometricReason);

    if (!mounted) return;

    if (result.isSuccess) {
      _biometricFailCount = 0; // Reset on success
      _goToHome();
    } else {
      _biometricFailCount++;

      if (_biometricFailCount >= 3) {
        // Force password login fallback
        showCustomSnackbar(
          context,
          'فشل التحقق بالبصمة عدة مرات. يرجى الدخول بكلمة المرور',
          isSuccess: false,
        );
        _biometricFailCount = 0; // Reset for next time
        return;
      }

      if (result.status == BiometricLoginStatus.sessionExpired) {
        showCustomSnackbar(context, result.message ?? l10n.loginFailed, isSuccess: false);
      } else if (result.status == BiometricLoginStatus.lockedOut) {
        showCustomSnackbar(context, result.message ?? l10n.biometricAuthFailed, isSuccess: false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    return Scaffold(
      backgroundColor: Colors.white,
      body: Stack(
        children: [
          Container(color: Theme.of(context).scaffoldBackgroundColor),

          // Orange Wavy Header
          Positioned(
            top: 0, left: 0, right: 0,
            child: ClipPath(
              clipper: TopWaveClipper(),
              child: Container(
                height: MediaQuery.of(context).size.height * 0.45,
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [Color(0xFFDCA965), Color(0xFFB8860B)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
                child: Stack(children: [
                  Positioned(
                    top: -50, right: -30,
                    child: Container(
                      width: 150, height: 150,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white.withOpacity(0.1),
                      ),
                    ),
                  ),
                ]),
              ),
            ).animate().fade(duration: 800.ms).slideY(begin: -0.2, end: 0, curve: Curves.easeOut),
          ),

          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Logo
                    Container(
                      margin: const EdgeInsets.only(bottom: 24),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.15),
                            blurRadius: 20,
                            spreadRadius: 2,
                          )
                        ],
                      ),
                      child: ClipOval(
                        child: Image.asset(
                          'assets/icon/logo.png',
                          width: 120,
                          height: 120,
                          fit: BoxFit.cover,
                        ),
                      ),
                    ).animate().fade(delay: 200.ms).scale(begin: const Offset(0.8, 1.0)),

                    // Card
                    Container(
                      margin: const EdgeInsets.symmetric(horizontal: 20),
                      decoration: BoxDecoration(
                        color: Theme.of(context).cardColor,
                        borderRadius: BorderRadius.circular(24),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.08),
                            blurRadius: 20,
                            offset: const Offset(0, 8),
                          )
                        ],
                      ),
                      child: Column(
                        children: [
                          // Tabs
                          TabBar(
                            controller: _tabController,
                            labelColor: const Color(0xFFFF6D00),
                            unselectedLabelColor: Colors.grey,
                            indicatorColor: const Color(0xFFFF6D00),
                            tabs: [
                              Tab(text: AppLocalizations.of(context)!.loginTab),
                              Tab(text: AppLocalizations.of(context)!.registerTab),
                            ],
                          ),
                          SizedBox(
                            height: 500,
                            child: TabBarView(
                              controller: _tabController,
                              children: [
                                _buildLoginForm(auth),
                                _buildRegisterForm(auth),
                              ],
                            ),
                          ),
                        ],
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

  Widget _buildLoginForm(AuthController auth) {
    return Form(
      key: _loginFormKey,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            if (auth.isBiometricAvailable && auth.isBiometricEnabled)
              _buildBiometricButton(auth),

            TextFormField(
              keyboardType: TextInputType.emailAddress,
              decoration: _inputDecoration(
                AppLocalizations.of(context)!.email,
                Icons.email_rounded,
              ),
              validator: (val) => Validators.validateEmail(
                val,
                AppLocalizations.of(context)!.required,
                AppLocalizations.of(context)!.required,
              ),
              onSaved: (val) => loginEmail = val!.trim(),
            ),
            const SizedBox(height: 16),

            TextFormField(
              obscureText: !_loginPasswordVisible,
              decoration: _inputDecoration(
                AppLocalizations.of(context)!.password,
                Icons.lock_rounded,
                suffix: IconButton(
                  icon: Icon(
                    _loginPasswordVisible ? Icons.visibility_off : Icons.visibility,
                    color: Colors.grey,
                  ),
                  onPressed: () => setState(() => _loginPasswordVisible = !_loginPasswordVisible),
                ),
              ),
              validator: (val) =>
                  (val == null || val.isEmpty) ? AppLocalizations.of(context)!.required : null,
              onSaved: (val) => loginPassword = val!,
            ),
            const SizedBox(height: 8),

            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => _showForgotPasswordSheet(context),
                child: Text(
                  AppLocalizations.of(context)!.forgotPassword ?? 'نسيت كلمة المرور؟',
                  style: const TextStyle(color: Color(0xFFFF6D00), fontSize: 13),
                ),
              ),
            ),
            const SizedBox(height: 16),

            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton(
                onPressed: auth.isLoading
                    ? null
                    : () async {
                        if (_loginFormKey.currentState!.validate()) {
                          _loginFormKey.currentState!.save();
                          final success = await auth.login(loginEmail, loginPassword);
                          if (success && mounted) {
                            if (auth.isBiometricAvailable && !auth.isBiometricEnabled) {
                              _promptEnableBiometrics(auth);
                            } else {
                              _goToHome();
                            }
                          } else if (mounted) {
                            showCustomSnackbar(context, auth.errorMessage ?? 'خطأ', isSuccess: false);
                          }
                        }
                      },
                style: _primaryButtonStyle(),
                child: auth.isLoading
                    ? const CircularProgressIndicator(color: Colors.white, strokeWidth: 2)
                    : Text(AppLocalizations.of(context)!.loginTab,
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              ),
            ),

            const SizedBox(height: 16),
            TextButton(
              onPressed: _goToHome,
              child: const Text(
                'الدخول كضيف',
                style: TextStyle(color: Colors.grey, fontSize: 14, fontWeight: FontWeight.w500),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBiometricButton(AuthController auth) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: FutureBuilder<String>(
        future: BiometricService.instance.availableTypesLabel,
        builder: (context, snap) {
          final label = snap.data ?? 'البصمة';
          return OutlinedButton.icon(
            onPressed: auth.isLoading ? null : _triggerBiometricLogin,
            icon: const Icon(Icons.fingerprint, size: 28, color: Color(0xFFFF6D00)),
            label: const Text(
              'الدخول بالبصمة',
              style: TextStyle(color: Color(0xFFFF6D00), fontWeight: FontWeight.w600),
            ),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(double.infinity, 52),
              side: const BorderSide(color: Color(0xFFFF6D00)),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            ),
          );
        },
      ),
    );
  }

  void _promptEnableBiometrics(AuthController auth) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('تفعيل الدخول بالبصمة', textAlign: TextAlign.center),
        content: const Text(
          'هل تريد تفعيل الدخول بالبصمة لتسريع الوصول إلى حسابك في المستقبل؟',
          textAlign: TextAlign.center,
        ),
        actions: [
          TextButton(
            onPressed: () { Navigator.pop(ctx); _goToHome(); },
            child: const Text('لاحقاً'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              final l10n = AppLocalizations.of(context)!;
              final enabled = await auth.enableBiometrics(reason: l10n.biometricEnableReason);
              if (mounted) {
                if (enabled) {
                  showCustomSnackbar(context, l10n.biometricEnabled, isSuccess: true);
                }
                _goToHome();
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFF6D00),
              foregroundColor: Colors.white,
            ),
            child: const Text('تفعيل'),
          ),
        ],
      ),
    );
  }

  Widget _buildRegisterForm(AuthController auth) {
    return Form(
      key: _regFormKey,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            TextFormField(
              decoration: _inputDecoration(
                AppLocalizations.of(context)!.fullNameLabel,
                Icons.person_rounded,
              ),
              validator: (val) => Validators.validateName(
                val,
                AppLocalizations.of(context)!.required,
                AppLocalizations.of(context)!.required,
              ),
              onSaved: (val) => regName = val!,
            ),
            const SizedBox(height: 16),
            TextFormField(
              keyboardType: TextInputType.phone,
              decoration: _inputDecoration(
                'رقم الجوال',
                Icons.phone_android_rounded,
              ),
              validator: (val) => (val == null || val.length < 9)
                  ? 'يرجى إدخال رقم جوال صحيح'
                  : null,
              onSaved: (val) => regPhone = val!.trim(),
            ),
            const SizedBox(height: 16),
            TextFormField(
              keyboardType: TextInputType.emailAddress,
              decoration: _inputDecoration(
                AppLocalizations.of(context)!.email,
                Icons.email_rounded,
              ),
              validator: (val) => Validators.validateEmail(
                val,
                AppLocalizations.of(context)!.required,
                AppLocalizations.of(context)!.required,
              ),
              onSaved: (val) => regEmail = val!.trim(),
            ),
            const SizedBox(height: 16),
            TextFormField(
              obscureText: !_regPasswordVisible,
              decoration: _inputDecoration(
                AppLocalizations.of(context)!.password,
                Icons.lock_rounded,
                suffix: IconButton(
                  icon: Icon(
                    _regPasswordVisible ? Icons.visibility_off : Icons.visibility,
                    color: Colors.grey,
                  ),
                  onPressed: () => setState(() => _regPasswordVisible = !_regPasswordVisible),
                ),
              ),
              validator: (val) => (val == null || val.length < 8)
                  ? 'كلمة المرور يجب أن تكون 8 أحرف على الأقل'
                  : null,
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
                          final success = await auth.register(
                            name: regName,
                            email: regEmail,
                            password: regPassword,
                            phone: regPhone,
                          );
                          if (success && mounted) {
                            _showOtpDialog(context, regEmail, isReset: false);
                          } else if (mounted) {
                            showCustomSnackbar(
                              context, auth.errorMessage ?? 'خطأ', isSuccess: false);
                          }
                        }
                      },
                style: _primaryButtonStyle(),
                child: auth.isLoading
                    ? const CircularProgressIndicator(color: Colors.white, strokeWidth: 2)
                    : Text(AppLocalizations.of(context)!.registerAction,
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showForgotPasswordSheet(BuildContext context) {
    final emailCtrl = TextEditingController();
    final formKey = GlobalKey<FormState>();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
          top: 24, left: 24, right: 24,
        ),
        child: Consumer<AuthController>(
          builder: (ctx, auth, _) => Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Icon(Icons.lock_reset, size: 48, color: Color(0xFFFF6D00)),
                const SizedBox(height: 12),
                  Text(
                    AppLocalizations.of(context)!.forgotPassword ?? 'نسيت كلمة المرور؟',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                const SizedBox(height: 8),
                const Text(
                  'أدخل بريدك الإلكتروني وسنرسل لك كود لإعادة تعيين كلمة المرور',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey, fontSize: 13),
                ),
                const SizedBox(height: 20),
                TextFormField(
                  controller: emailCtrl,
                  keyboardType: TextInputType.emailAddress,
                  decoration: _inputDecoration('البريد الإلكتروني', Icons.email_rounded),
                  validator: (val) => Validators.validateEmail(val, 'مطلوب', 'بريد غير صالح'),
                ),
                const SizedBox(height: 20),
                ElevatedButton(
                  onPressed: auth.isLoading
                      ? null
                      : () async {
                          if (formKey.currentState!.validate()) {
                            final email = emailCtrl.text.trim();
                            final success = await auth.forgotPassword(email);
                            if (!ctx.mounted) return;
                            Navigator.pop(ctx);
                            if (mounted) {
                              showCustomSnackbar(
                                context,
                                'إذا كان البريد مسجلاً، ستصلك رسالة قريباً',
                                isSuccess: true,
                              );
                              if (success) {
                                _showResetPasswordSheet(context, email);
                              }
                            }
                          }
                        },
                  style: _primaryButtonStyle(),
                  child: auth.isLoading
                      ? const CircularProgressIndicator(color: Colors.white, strokeWidth: 2)
                      : const Text('إرسال الكود', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _showResetPasswordSheet(BuildContext context, String email) {
    final codeCtrl = TextEditingController();
    final passCtrl = TextEditingController();
    final confirmCtrl = TextEditingController();
    final formKey = GlobalKey<FormState>();
    bool passVisible = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
            top: 24, left: 24, right: 24,
          ),
          child: Consumer<AuthController>(
            builder: (ctx, auth, _) => Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.verified_user_rounded, size: 48, color: Color(0xFFFF6D00)),
                  const SizedBox(height: 12),
                  const Text(
                    'إعادة تعيين كلمة المرور',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'أدخل الكود المرسل إلى $email وكلمة المرور الجديدة',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.grey, fontSize: 13),
                  ),
                  const SizedBox(height: 20),

                  TextFormField(
                    controller: codeCtrl,
                    keyboardType: TextInputType.number,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 28, letterSpacing: 10, fontWeight: FontWeight.bold),
                    maxLength: 6,
                    decoration: InputDecoration(
                      counterText: '',
                      hintText: '------',
                      filled: true,
                      fillColor: Colors.grey.shade100,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide.none,
                      ),
                    ),
                    validator: (val) =>
                        (val == null || val.length != 6) ? 'أدخل الكود المكوّن من 6 أرقام' : null,
                  ),
                  const SizedBox(height: 16),

                  TextFormField(
                    controller: passCtrl,
                    obscureText: !passVisible,
                    decoration: _inputDecoration(
                      'كلمة المرور الجديدة',
                      Icons.lock_rounded,
                      suffix: IconButton(
                        icon: Icon(passVisible ? Icons.visibility_off : Icons.visibility, color: Colors.grey),
                        onPressed: () => setSheetState(() => passVisible = !passVisible),
                      ),
                    ),
                    validator: (val) {
                      if (val == null || val.length < 8) return 'يجب أن تكون 8 أحرف على الأقل';
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),

                  TextFormField(
                    controller: confirmCtrl,
                    obscureText: true,
                    decoration: _inputDecoration('تأكيد كلمة المرور', Icons.lock_outline_rounded),
                    validator: (val) =>
                        val != passCtrl.text ? 'كلمتا المرور غير متطابقتين' : null,
                  ),
                  const SizedBox(height: 20),

                  if (auth.errorMessage != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(
                        auth.errorMessage!,
                        style: const TextStyle(color: Colors.red, fontSize: 13),
                        textAlign: TextAlign.center,
                      ),
                    ),

                  ElevatedButton(
                    onPressed: auth.isLoading
                        ? null
                        : () async {
                            if (formKey.currentState!.validate()) {
                              final success = await auth.resetPassword(
                                email: email,
                                code: codeCtrl.text,
                                newPassword: passCtrl.text,
                              );
                              if (!ctx.mounted) return;
                              if (success) {
                                Navigator.pop(ctx);
                                if (mounted) {
                                  showCustomSnackbar(context, 'تم تعيين كلمة المرور بنجاح ✅', isSuccess: true);
                                  _goToHome();
                                }
                              }
                            }
                          },
                    style: _primaryButtonStyle(),
                    child: auth.isLoading
                        ? const CircularProgressIndicator(color: Colors.white, strokeWidth: 2)
                        : const Text('تعيين كلمة المرور', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _showOtpDialog(BuildContext context, String email, {bool isReset = false}) {
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
                  counterText: '',
                  filled: true,
                  fillColor: Colors.grey.shade100,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                ),
              ),
              if (auth.errorMessage != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8.0),
                  child: Text(auth.errorMessage!,
                      style: const TextStyle(color: Colors.red, fontSize: 12)),
                ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('إلغاء'),
            ),
            ElevatedButton(
              onPressed: auth.isLoading
                  ? null
                  : () async {
                      final success = await auth.verifyOtp(email, codeController.text);
                      if (success && context.mounted) {
                        Navigator.pop(context);
                        _goToHome();
                      }
                    },
              style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFF6D00),
                  foregroundColor: Colors.white),
              child: auth.isLoading
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                  : const Text('تأكيد'),
            ),
          ],
        ),
      ),
    );
  }

  InputDecoration _inputDecoration(String label, IconData icon, {Widget? suffix}) {
    return InputDecoration(
      labelText: label,
      prefixIcon: Icon(icon, color: const Color(0xFFFF6D00)),
      suffixIcon: suffix,
      filled: true,
      fillColor: Colors.grey.shade50,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide.none,
      ),
    );
  }

  ButtonStyle _primaryButtonStyle() {
    return ElevatedButton.styleFrom(
      backgroundColor: const Color(0xFFFF6D00),
      foregroundColor: Colors.white,
      minimumSize: const Size(double.infinity, 56),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      elevation: 8,
      shadowColor: const Color(0xFFFF6D00).withOpacity(0.5),
    );
  }
}

class TopWaveClipper extends CustomClipper<Path> {
  @override
  Path getClip(Size size) {
    var path = Path();
    path.lineTo(0, size.height - 80);
    path.quadraticBezierTo(
        size.width / 4, size.height, size.width / 2.25, size.height - 30);
    path.quadraticBezierTo(
        size.width - (size.width / 3.25), size.height - 90, size.width, size.height - 40);
    path.lineTo(size.width, 0);
    path.close();
    return path;
  }

  @override
  bool shouldReclip(CustomClipper<Path> oldClipper) => false;
}
