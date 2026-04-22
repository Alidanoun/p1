import 'package:flutter/material.dart';
import '../l10n/generated/app_localizations.dart';
import '../services/storage_service.dart';

class NotificationDetailScreen extends StatelessWidget {
  final dynamic notification;

  const NotificationDetailScreen({Key? key, required this.notification}) : super(key: key);

  String _localizedField(String field) {
    final isEn = StorageService.instance.getLanguageCode() == 'en';
    if (isEn) {
      final enValue = notification['${field}En'];
      if (enValue != null && enValue.toString().isNotEmpty) return enValue;
    }
    return notification[field] ?? '';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final title = _localizedField('title').isNotEmpty ? _localizedField('title') : l10n.notificationsTitle;
    final message = _localizedField('message');
    final type = notification['type'] ?? 'general';
    final dateStr = notification['createdAt'];
    
    final primaryColor = Theme.of(context).primaryColor;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.notificationDetails),
        centerTitle: true,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header with Icon
            Center(
              child: Container(
                width: 120,
                height: 120,
                decoration: BoxDecoration(
                  color: Colors.black,
                  shape: BoxShape.circle,
                  image: const DecorationImage(
                    image: AssetImage('assets/images/app_icon_final_perfect.png'),
                    fit: BoxFit.cover,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: primaryColor.withOpacity(0.3),
                      blurRadius: 20,
                      spreadRadius: 2,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 30),
            
            // Title
            Text(
              title,
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            
            // Date
            Row(
              children: [
                const Icon(Icons.access_time, size: 16, color: Colors.grey),
                const SizedBox(width: 8),
                Text(
                  _formatDate(dateStr),
                  style: const TextStyle(color: Colors.grey, fontSize: 14),
                ),
              ],
            ),
            
            const SizedBox(height: 12),
            

            
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 20),
              child: Divider(),
            ),
            
            // Message Content
            Text(
              l10n.messageContent,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: Colors.grey,
              ),
            ),
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: isDark ? Colors.white.withOpacity(0.05) : Colors.grey[100],
                borderRadius: BorderRadius.circular(15),
              ),
              child: Text(
                message,
                style: const TextStyle(
                  fontSize: 18,
                  height: 1.6,
                ),
              ),
            ),
          ],
        ),
      ),
    );
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
