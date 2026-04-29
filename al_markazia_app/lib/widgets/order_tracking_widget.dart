import 'package:flutter/material.dart';
import '../models/order_model.dart';
import '../l10n/generated/app_localizations.dart';
import 'package:intl/intl.dart' as intl;

class OrderTrackingWidget extends StatelessWidget {
  final OrderModel order;
  final VoidCallback onTap;

  const OrderTrackingWidget({
    super.key,
    required this.order,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final locale = Localizations.localeOf(context).languageCode;

    // Calculate arrival window
    String arrivalText = '';
    if (order.estimatedArrivalAt != null) {
      final arrival = order.estimatedArrivalAt!;
      final startRange = arrival.subtract(const Duration(minutes: 5));
      final endRange = arrival.add(const Duration(minutes: 5));
      
      final timeFormat = intl.DateFormat.Hm();
      arrivalText = locale == 'ar' 
        ? 'يصل خلال ${timeFormat.format(startRange)} - ${timeFormat.format(endRange)}'
        : 'Arrives between ${timeFormat.format(startRange)} - ${timeFormat.format(endRange)}';
    }

    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF1E1E1E) : Colors.white,
          borderRadius: BorderRadius.circular(24),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.05),
              blurRadius: 15,
              offset: const Offset(0, 5),
            )
          ],
        ),
        child: Column(
          children: [
            // Header: Tooltip style
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: isDark ? Colors.white10 : Colors.grey.shade900,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
              ),
              child: Row(
                children: [
                  Icon(Icons.info_outline, size: 16, color: Colors.white.withOpacity(0.7)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      locale == 'ar' ? 'اضغط هنا للمزيد من التفاصيل عن طلبك' : 'Tap here for more order details',
                      style: TextStyle(color: Colors.white.withOpacity(0.9), fontSize: 12),
                    ),
                  ),
                  Icon(Icons.close, size: 16, color: Colors.white.withOpacity(0.5)),
                ],
              ),
            ),
            
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            arrivalText,
                            style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20),
                          ),
                          const SizedBox(height: 4),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: Colors.green.withOpacity(0.1),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              locale == 'ar' ? 'في الموعد' : 'On Time',
                              style: const TextStyle(color: Colors.green, fontSize: 12, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ],
                      ),
                      // Restaurant Logo placeholder
                      Container(
                        width: 48, height: 48,
                        decoration: BoxDecoration(
                          color: Colors.red.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Center(child: Icon(Icons.restaurant, color: Colors.red)),
                      ),
                    ],
                  ),
                  
                  const SizedBox(height: 20),
                  
                  // Progress Bar Dots
                  _buildProgressBar(order.status ?? 'pending', isDark),
                  
                  const SizedBox(height: 20),
                  
                  Text(
                    order.getDisplayStatus(l10n).replaceAll(RegExp(r'[^\w\s\u0600-\u06FF]'), '').trim(),
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _getStatusSubtitle(order.status ?? 'pending', locale),
                    style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
                  ),
                ],
              ),
            ),
            
            // Footer: Address
            if (order.address != null) ...[
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Icon(Icons.location_on, size: 20, color: Colors.grey.shade600),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            locale == 'ar' ? 'ستؤصل الطلب إلى' : 'Delivering order to',
                            style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
                          ),
                          Text(
                            order.address!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildProgressBar(String status, bool isDark) {
    int step = 0;
    if (status == 'pending') step = 0;
    if (status == 'confirmed' || status == 'preparing') step = 1;
    if (status == 'ready' || status == 'in_route') step = 2;
    if (status == 'delivered') step = 3;

    return Row(
      children: List.generate(4, (index) {
        bool isCompleted = index <= step;
        bool isCurrent = index == step;
        
        return Expanded(
          child: Row(
            children: [
              // Dot
              Container(
                width: 24, height: 24,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isCompleted ? Colors.orange : (isDark ? Colors.white10 : Colors.grey.shade200),
                  border: isCurrent ? Border.all(color: Colors.orange.withOpacity(0.3), width: 4) : null,
                ),
                child: index < step 
                  ? const Icon(Icons.check, size: 14, color: Colors.white)
                  : (isCurrent ? Center(child: Container(width: 8, height: 8, decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle))) : null),
              ),
              // Line
              if (index < 3)
                Expanded(
                  child: Container(
                    height: 3,
                    color: index < step ? Colors.orange : (isDark ? Colors.white10 : Colors.grey.shade200),
                  ),
                ),
            ],
          ),
        );
      }),
    );
  }

  String _getStatusSubtitle(String status, String locale) {
    switch (status) {
      case 'pending':
        return locale == 'ar' ? 'استلمنا طلبك ☀️ سنهتم بالباقي ونخبرك بأي جديد' : 'We received your order ☀️ We will handle the rest';
      case 'preparing':
        return locale == 'ar' ? 'يتم تحضير طلبك الآن في المطبخ' : 'Your order is being prepared in the kitchen';
      case 'ready':
        return locale == 'ar' ? 'طلبك جاهز تماماً وبانتظار السائق' : 'Your order is ready and waiting for the driver';
      case 'in_route':
        return locale == 'ar' ? 'السائق في الطريق إليك الآن' : 'The driver is on the way to you now';
      default:
        return '';
    }
  }
}
