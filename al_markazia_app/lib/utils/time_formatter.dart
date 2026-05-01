import 'package:intl/intl.dart';
import '../l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';

class TimeFormatter {
  static String formatReopeningTime(DateTime nextOpening, BuildContext context) {
    final now = DateTime.now();
    final diff = nextOpening.difference(now);
    final locale = Localizations.localeOf(context).languageCode;
    final l10n = AppLocalizations.of(context)!;

    if (diff.inMinutes < 60 && diff.inMinutes > 0) {
      if (locale == 'ar') {
        return 'يفتح بعد ${diff.inMinutes} دقيقة';
      }
      return 'Opens in ${diff.inMinutes} minutes';
    }

    final isToday = nextOpening.day == now.day &&
        nextOpening.month == now.month &&
        nextOpening.year == now.year;

    // 🛡️ Timezone Fix: Ensure we show the time correctly. 
    // If the device is in a different timezone (like UTC), DateFormat.jm() will shift the hour.
    // For a local restaurant, we usually want to show the "Wall Clock" time of the restaurant.
    // 🛡️ Timezone Fix: Restaurant is in Jordan (UTC+3). 
    // We force the display to Amman time so it shows "9:00 AM" regardless of device timezone.
    final ammanTime = nextOpening.toUtc().add(const Duration(hours: 3));
    final timeStr = DateFormat.jm(locale).format(ammanTime);

    if (isToday) {
      if (locale == 'ar') {
        return 'يفتح اليوم الساعة $timeStr';
      }
      return 'Opens today at $timeStr';
    }

    final isTomorrow = nextOpening.day == now.add(const Duration(days: 1)).day &&
        nextOpening.month == now.add(const Duration(days: 1)).month &&
        nextOpening.year == now.add(const Duration(days: 1)).year;

    if (isTomorrow) {
      if (locale == 'ar') {
        return 'يفتح غداً الساعة $timeStr';
      }
      return 'Opens tomorrow at $timeStr';
    }

    // Default fallback
    final dateStr = DateFormat.MMMd(locale).format(nextOpening);
    if (locale == 'ar') {
      return 'يفتح في $dateStr الساعة $timeStr';
    }
    return 'Opens on $dateStr at $timeStr';
  }

  static String formatCountdown(Duration duration) {
    if (duration.isNegative) return "00:00";
    String twoDigits(int n) => n.toString().padLeft(2, '0');
    final minutes = twoDigits(duration.inMinutes.remainder(60));
    final seconds = twoDigits(duration.inSeconds.remainder(60));
    return '$minutes:$seconds';
  }
}
