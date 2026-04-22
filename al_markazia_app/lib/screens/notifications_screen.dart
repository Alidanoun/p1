import 'package:flutter/material.dart';
import '../services/notification_service.dart';
import '../services/storage_service.dart';
import 'notification_detail_screen.dart';
import '../l10n/generated/app_localizations.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({Key? key}) : super(key: key);

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    NotificationService().addListener(_onUpdate);
    NotificationService().fetchNotifications();
  }

  void _onUpdate() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    NotificationService().removeListener(_onUpdate);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ns = NotificationService();
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bgColor = Theme.of(context).scaffoldBackgroundColor;
    final primaryColor = Theme.of(context).primaryColor;

    return Scaffold(
      backgroundColor: bgColor,
      appBar: AppBar(
        title: Text(AppLocalizations.of(context)!.notificationsTitle, style: const TextStyle(fontWeight: FontWeight.bold)),
        centerTitle: true,
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: ns.notifications.isEmpty
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.notifications_off_rounded, size: 80, color: Colors.grey.withOpacity(0.5)),
                  const SizedBox(height: 16),
                  Text(AppLocalizations.of(context)!.noNotifications, style: const TextStyle(fontSize: 18, color: Colors.grey)),
                ],
              ),
            )
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: ns.notifications.length,
              itemBuilder: (context, index) {
                final notif = ns.notifications[index];
                final isRead = notif['isRead'] ?? false;

                return GestureDetector(
                  onTap: () {
                    if (!isRead) ns.markAsRead(notif['id']);
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (context) => NotificationDetailScreen(notification: notif),
                      ),
                    );
                  },
                  child: Container(
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: isRead 
                        ? (isDark ? const Color(0xFF1E1E1E) : Colors.white)
                        : primaryColor.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: isRead ? Colors.transparent : primaryColor.withOpacity(0.3),
                      ),
                      boxShadow: [
                        if (!isDark)
                          BoxShadow(
                            color: Colors.black.withOpacity(isRead ? 0.05 : 0.1),
                            blurRadius: 10,
                            offset: const Offset(0, 4),
                          )
                      ],
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            image: const DecorationImage(
                              image: AssetImage('assets/images/app_icon_final_perfect.png'),
                              fit: BoxFit.cover,
                            ),
                            border: Border.all(color: primaryColor.withOpacity(0.2)),
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _localizedField(notif, 'title'),
                                style: TextStyle(
                                  fontWeight: isRead ? FontWeight.w600 : FontWeight.w800,
                                  fontSize: 16,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                _localizedField(notif, 'message'),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 14,
                                  color: Colors.grey,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                _formatDate(notif['createdAt']),
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: Colors.grey,
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (!isRead)
                          Container(
                            width: 10,
                            height: 10,
                            margin: const EdgeInsets.only(top: 6),
                            decoration: const BoxDecoration(
                              color: Colors.redAccent,
                              shape: BoxShape.circle,
                            ),
                          )
                      ],
                    ),
                  ),
                );
              },
            ),
    );
  }

  String _localizedField(dynamic notif, String field) {
    final isEn = StorageService.instance.getLanguageCode() == 'en';
    if (isEn) {
      final enKey = '${field}En';
      final enValue = notif[enKey];
      if (enValue != null && enValue.toString().isNotEmpty) return enValue;
    }
    return notif[field] ?? '';
  }

  String _formatDate(String? dateStr) {
    if (dateStr == null) return '';
    try {
      final date = DateTime.parse(dateStr).toLocal();
      return '${date.year}/${date.month}/${date.day} ${date.hour}:${date.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return '';
    }
  }
}
