import 'package:flutter/material.dart';
import '../l10n/generated/app_localizations.dart';

Future<bool?> showCustomConfirmDialog({
  required BuildContext context,
  required String title,
  required String content,
  String? confirmText,
  String? cancelText,
  bool isDestructive = false,
}) {
  final l10n = AppLocalizations.of(context)!;
  final effectiveConfirm = confirmText ?? l10n.confirm;
  final effectiveCancel = cancelText ?? l10n.cancel;
  return showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
      content: Text(content),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(false),
          child: Text(effectiveCancel, style: const TextStyle(color: Colors.grey)),
        ),
        ElevatedButton(
          onPressed: () => Navigator.of(ctx).pop(true),
          style: ElevatedButton.styleFrom(
            backgroundColor: isDestructive ? Colors.red : Theme.of(context).primaryColor,
          ),
          child: Text(effectiveConfirm),
        ),
      ],
    ),
  );
}
