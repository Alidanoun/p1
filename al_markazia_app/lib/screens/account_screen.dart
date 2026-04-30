import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';
import 'package:url_launcher/url_launcher.dart';
import '../l10n/generated/app_localizations.dart';
import '../services/storage_service.dart';
import '../services/session_service.dart';
import '../services/api_service.dart';
import '../features/auth/auth_controller.dart';
import 'auth_screen.dart';
import 'package:provider/provider.dart';
import '../services/biometric_service.dart';
import '../widgets/custom_snackbar.dart';

class AccountScreen extends StatefulWidget {
  const AccountScreen({Key? key}) : super(key: key);

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  bool _notificationsEnabled = true;

  Future<void> _changeLanguage() async {
    final l10n = AppLocalizations.of(context)!;
    final currentLang = StorageService.instance.getLanguageCode();
    
    showCupertinoModalPopup(
      context: context,
      builder: (context) => CupertinoActionSheet(
        title: Text(l10n.language),
        actions: [
          CupertinoActionSheetAction(
            onPressed: () {
              StorageService.instance.setLanguage('ar');
              Navigator.pop(context);
            },
            child: Text(l10n.arabic, style: TextStyle(fontWeight: currentLang == 'ar' ? FontWeight.bold : FontWeight.normal)),
          ),
          CupertinoActionSheetAction(
            onPressed: () {
              StorageService.instance.setLanguage('en');
              Navigator.pop(context);
            },
            child: Text(l10n.english, style: TextStyle(fontWeight: currentLang == 'en' ? FontWeight.bold : FontWeight.normal)),
          ),
        ],
        cancelButton: CupertinoActionSheetAction(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.cancel),
        ),
      ),
    );
  }

  Future<void> _logout() async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.logout),
        content: Text(l10n.logoutConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l10n.cancel)),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true), 
            child: Text(l10n.logout, style: const TextStyle(color: Colors.red))
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await context.read<AuthController>().logout();
      if (mounted) {
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const AuthScreen()),
          (r) => false,
        );
      }
    }
  }

  String get currentLang => StorageService.instance.getLanguageCode();

  Future<void> _launchWhatsApp() async {
    const String phone = "962795493921";
    final Uri whatsappUrl = Uri.parse("whatsapp://send?phone=$phone");
    final Uri webUrl = Uri.parse("https://wa.me/$phone");
    
    try {
      if (await canLaunchUrl(whatsappUrl)) {
        await launchUrl(whatsappUrl);
      } else {
        await launchUrl(webUrl, mode: LaunchMode.externalApplication);
      }
    } catch (e) {
      if (mounted) {
        showCustomSnackbar(context, AppLocalizations.of(context)!.whatsAppError, isSuccess: false);
      }
    }
  }

  Future<void> _launchPhone() async {
    final Uri phoneUrl = Uri.parse("tel:+962795493921");
    try {
      if (await canLaunchUrl(phoneUrl)) {
        await launchUrl(phoneUrl);
      } else {
        if (mounted) {
          showCustomSnackbar(context, AppLocalizations.of(context)!.phoneError, isSuccess: false);
        }
      }
    } catch (e) {
      if (mounted) {
        showCustomSnackbar(context, AppLocalizations.of(context)!.supportError, isSuccess: false);
      }
    }
  }

  Widget _buildBiometricTile() {
    final l10n = AppLocalizations.of(context)!;
    return Consumer<AuthController>(
      builder: (context, auth, _) {
        if (!auth.isBiometricAvailable) return const SizedBox.shrink();

        return FutureBuilder<String>(
          future: BiometricService.instance.availableTypesLabel,
          builder: (context, snap) {
            final label = snap.data ?? l10n.loginWithFingerprint;
            final isDark = Theme.of(context).brightness == Brightness.dark;
            final cardColor = isDark ? const Color(0xFF1C1C1E) : Colors.white;

            return Column(
              children: [
                const SizedBox(height: 16),
                _buildSettingsCard(
                  context: context,
                  title: l10n.loginWithFingerprint,
                  icon: Icons.fingerprint,
                  iconColor: auth.isBiometricEnabled ? const Color(0xFFFF6D00) : Colors.grey,
                  cardColor: cardColor,
                  trailing: CupertinoSwitch(
                    value: auth.isBiometricEnabled,
                    activeColor: const Color(0xFFFF6D00),
                    onChanged: (val) async {
                      if (val) {
                        final enabled = await auth.enableBiometrics(reason: l10n.biometricEnableReason);
                        if (mounted) {
                          showCustomSnackbar(
                            context,
                            enabled ? l10n.biometricEnabled : l10n.biometricAuthFailed,
                            isSuccess: enabled,
                          );
                        }
                      } else {
                        await auth.disableBiometrics();
                        if (mounted) {
                          showCustomSnackbar(context, l10n.confirm, isSuccess: true);
                        }
                      }
                    },
                  ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final l10n = AppLocalizations.of(context)!;
    final user = auth.user;
    final bool isDark = Theme.of(context).brightness == Brightness.dark;
    final bgColor = isDark ? const Color(0xFF101010) : const Color(0xFFF5F5F7);
    final cardColor = isDark ? const Color(0xFF1C1C1E) : Colors.white;
    final primaryColor = Theme.of(context).primaryColor;

    return Scaffold(
      backgroundColor: bgColor,
      appBar: AppBar(
        backgroundColor: bgColor,
        title: Text(l10n.settings, style: const TextStyle(fontWeight: FontWeight.w900)),
      ),
      body: RefreshIndicator(
        onRefresh: () => auth.refreshProfile(),
        color: primaryColor,
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
          physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 36,
                  backgroundColor: primaryColor.withOpacity(0.1),
                  child: Icon(Icons.person_rounded, size: 40, color: primaryColor),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(user?['name'] ?? l10n.guest, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 4),
                      Text(user?['phone'] ?? l10n.phoneNotAvailable, style: const TextStyle(color: Colors.grey, fontSize: 14)),
                    ],
                  ),
                )
              ],
            ),
            const SizedBox(height: 32),
  
            _buildSettingsCard(
              context: context,
              title: l10n.loyaltyPoints,
              icon: Icons.stars_rounded,
              cardColor: cardColor,
              trailing: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: primaryColor.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  '${user?['points'] ?? 0} ${l10n.points}',
                  style: TextStyle(color: primaryColor, fontWeight: FontWeight.bold),
                ),
              ),
            ),
            
            const SizedBox(height: 16),
  
            GestureDetector(
              onTap: _changeLanguage,
              child: _buildSettingsCard(
                context: context,
                title: l10n.language,
                icon: Icons.language_rounded,
                cardColor: cardColor,
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      currentLang == 'ar' ? 'العربية' : 'English',
                      style: TextStyle(color: primaryColor, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(width: 8),
                    const Icon(Icons.arrow_forward_ios, size: 14, color: Colors.grey),
                  ],
                ),
              ),
            ),
  
            const SizedBox(height: 16),
  
            _buildSettingsCard(
              context: context,
              title: l10n.darkMode,
              icon: Icons.dark_mode_rounded,
              cardColor: cardColor,
              trailing: CupertinoSwitch(
                value: StorageService.instance.getDarkMode(),
                activeColor: primaryColor,
                onChanged: (val) {
                  StorageService.instance.setDarkMode(val);
                },
              ),
            ),
  
            // 🆕 Biometric Toggle Tile
            _buildBiometricTile(),
  
            const SizedBox(height: 16),
  
            _buildSettingsCard(
              context: context,
              title: l10n.notifications,
              icon: Icons.notifications_rounded,
              cardColor: cardColor,
              trailing: CupertinoSwitch(
                value: _notificationsEnabled,
                activeColor: primaryColor,
                onChanged: (val) {
                  setState(() => _notificationsEnabled = val);
                },
              ),
            ),
  
            const SizedBox(height: 16),
  
            Row(
              children: [
                Expanded(
                  child: GestureDetector(
                    onTap: _launchWhatsApp,
                    child: _buildSettingsCard(
                      context: context,
                      title: l10n.whatsapp,
                      icon: Icons.chat_rounded,
                      iconColor: Colors.green,
                      cardColor: cardColor,
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: GestureDetector(
                    onTap: _launchPhone,
                    child: _buildSettingsCard(
                      context: context,
                      title: l10n.support,
                      icon: Icons.headset_mic_rounded,
                      cardColor: cardColor,
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
  
            const SizedBox(height: 16),
  
            GestureDetector(
              onTap: _logout,
              child: _buildSettingsCard(
                context: context,
                title: l10n.logout,
                icon: Icons.logout_rounded,
                cardColor: cardColor,
              ),
            ),
            
            const SizedBox(height: 100),
          ],
        ),
      ),
    );
  }

  Widget _buildSettingsCard({
    required BuildContext context,
    required String title,
    required IconData icon,
    required Color cardColor,
    Color? iconColor,
    Widget? trailing,
    bool isDense = false,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 20, vertical: isDense ? 16 : 20),
      decoration: BoxDecoration(
        color: cardColor,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          if (!isDark)
            BoxShadow(
              color: Colors.black.withOpacity(0.02),
              blurRadius: 10,
              offset: const Offset(0, 4),
            )
        ],
      ),
      child: Row(
        children: [
          Icon(
            icon,
            size: 26,
            color: iconColor ?? (isDark ? Colors.white : Colors.black87),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Text(
              title,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: isDark ? Colors.white : Colors.black87,
              ),
            ),
          ),
          if (trailing != null) trailing,
        ],
      ),
    );
  }
}
