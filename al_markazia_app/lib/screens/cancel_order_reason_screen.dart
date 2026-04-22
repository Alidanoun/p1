import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/order_model.dart';
import '../features/orders/order_controller.dart';
import '../l10n/generated/app_localizations.dart';

class CancelOrderReasonScreen extends StatefulWidget {
  final OrderModel order;
  const CancelOrderReasonScreen({Key? key, required this.order}) : super(key: key);

  @override
  State<CancelOrderReasonScreen> createState() => _CancelOrderReasonScreenState();
}

class _CancelOrderReasonScreenState extends State<CancelOrderReasonScreen> {
  String? _selectedReason;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final primaryColor = Theme.of(context).primaryColor;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final ordersController = context.watch<OrderController>();

    final reasons = [
      l10n.cancelReason1,
      l10n.cancelReason2,
      l10n.cancelReason3,
      l10n.cancelReason4,
    ];

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.cancelOrder, style: const TextStyle(fontWeight: FontWeight.bold)),
        elevation: 0,
      ),
      body: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.cancelReasonTitle,
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    '${l10n.orderIdLabel} ${widget.order.orderNumber ?? widget.order.orderId}',
                    style: TextStyle(color: Colors.grey.shade500),
                  ),
                  const SizedBox(height: 32),
                  ...reasons.map((reason) => _buildReasonItem(reason, primaryColor, isDark)).toList(),
                ],
              ),
            ),
          ),
          
          if (_selectedReason != null)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
                  if (_selectedReason == l10n.cancelReason4)
                    Container(
                      padding: const EdgeInsets.all(16),
                      margin: const EdgeInsets.only(bottom: 20),
                      decoration: BoxDecoration(
                        color: Colors.amber.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: Colors.amber.withOpacity(0.3)),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.info_outline, color: Colors.amber),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              l10n.otherReasonNote,
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ],
                      ),
                    ),
                  
                  SizedBox(
                    width: double.infinity,
                    height: 56,
                    child: ElevatedButton(
                      onPressed: ordersController.isLoading ? null : _submitCancellation,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.red,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        elevation: 0,
                      ),
                      child: ordersController.isLoading 
                        ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                        : Text(l10n.confirm, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildReasonItem(String reason, Color primaryColor, bool isDark) {
    final isSelected = _selectedReason == reason;
    return GestureDetector(
      onTap: () => setState(() => _selectedReason = reason),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
        decoration: BoxDecoration(
          color: isSelected ? Colors.red.withOpacity(0.1) : (isDark ? const Color(0xFF1E1E1E) : Colors.grey.shade50),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isSelected ? Colors.red : Colors.transparent,
            width: 2,
          ),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                reason,
                style: TextStyle(
                  fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                  fontSize: 15,
                ),
              ),
            ),
            if (isSelected)
              const Icon(Icons.check_circle_rounded, color: Colors.red)
            else
              Icon(Icons.circle_outlined, color: Colors.grey.withOpacity(0.3)),
          ],
        ),
      ),
    );
  }

  Future<void> _submitCancellation() async {
    if (_selectedReason == null) return;
    
    final success = await context.read<OrderController>().cancelOrder(
      widget.order.orderId,
      _selectedReason!,
    );
    
    if (success) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم إرسال طلب الإلغاء بنجاح'), backgroundColor: Colors.green),
        );
        Navigator.pop(context, true);
      }
    } else {
      if (mounted) {
        final error = context.read<OrderController>().errorMessage;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('فشل الإلغاء: $error'), backgroundColor: Colors.red),
        );
      }
    }
  }
}
