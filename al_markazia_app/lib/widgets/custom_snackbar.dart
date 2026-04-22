import 'package:flutter/material.dart';

void showCustomSnackbar(BuildContext context, String message, {bool isSuccess = true}) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Row(
        children: [
          Icon(
            isSuccess ? Icons.check_circle : Icons.error,
            color: Colors.white,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: Colors.white, fontFamily: 'Cairo', fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
      backgroundColor: isSuccess ? Colors.green.shade600 : Colors.red.shade600,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      margin: const EdgeInsets.all(16),
      duration: const Duration(seconds: 3),
    ),
  );
}
