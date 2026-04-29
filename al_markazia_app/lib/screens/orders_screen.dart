import 'package:flutter/material.dart';
import 'package:flutter_rating_bar/flutter_rating_bar.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';
import '../l10n/generated/app_localizations.dart';
import '../models/order_model.dart';
import '../services/storage_service.dart';
import '../features/orders/order_controller.dart';
import 'cart_screen.dart';
import 'checkout_screen.dart';
import '../features/cart/cart_controller.dart';
import 'cancel_order_reason_screen.dart';


class OrdersScreen extends StatefulWidget {
  const OrdersScreen({Key? key}) : super(key: key);

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  int _selectedTab = 0; // 0: Active, 1: History

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<OrderController>().fetchOrders();
    });
  }

  @override
  void dispose() {
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final primaryColor = Theme.of(context).primaryColor;
    final ordersController = context.watch<OrderController>();

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.myOrders, style: const TextStyle(fontWeight: FontWeight.w900)),
        elevation: 0,
        backgroundColor: Colors.transparent,
      ),
      body: Column(
        children: [
          // Custom Tab Switcher
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
            child: Container(
              height: 50,
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF1E1E1E) : Colors.grey.shade100,
                borderRadius: BorderRadius.circular(25),
              ),
              child: Row(
                children: [
                  _buildTabButton(0, l10n.activeOrders, primaryColor, isDark),
                  _buildTabButton(1, l10n.orderHistory, primaryColor, isDark),
                ],
              ),
            ),
          ),

          Expanded(
            child: RefreshIndicator(
              onRefresh: () => context.read<OrderController>().fetchOrders(),
              child: _buildOrderList(ordersController),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTabButton(int index, String label, Color primaryColor, bool isDark) {
    final isSelected = _selectedTab == index;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _selectedTab = index),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 300),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: isSelected ? primaryColor : Colors.transparent,
            borderRadius: BorderRadius.circular(25),
            boxShadow: isSelected ? [
              BoxShadow(
                color: primaryColor.withOpacity(0.3),
                blurRadius: 8,
                offset: const Offset(0, 4),
              )
            ] : null,
          ),
          child: Text(
            label,
            style: TextStyle(
              color: isSelected ? Colors.black : (isDark ? Colors.white70 : Colors.black54),
              fontWeight: FontWeight.bold,
              fontSize: 14,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildOrderList(OrderController controller) {
    final l10n = AppLocalizations.of(context)!;
    final displayList = _selectedTab == 0 ? controller.activeOrders : controller.historyOrders;

    if (controller.isLoading && displayList.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (displayList.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const SizedBox(height: 100),
          Center(
            child: Column(
              children: [
                Icon(Icons.receipt_long_outlined, size: 80, color: Colors.grey.withOpacity(0.3)),
                const SizedBox(height: 16),
                Text(
                  _selectedTab == 0 ? l10n.noActiveOrders : l10n.noHistoryOrders,
                  style: const TextStyle(fontSize: 16, color: Colors.grey, fontWeight: FontWeight.bold),
                ),
              ],
            ),
          ),
        ],
      );
    }

    return ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 100),
      itemCount: displayList.length,
      itemBuilder: (context, index) {
        final order = displayList[index];
        return _selectedTab == 0 
            ? _buildActiveOrderCard(order) 
            : _buildHistoryOrderCard(order);
      },
    );
  }

  Widget _buildActiveOrderCard(OrderModel order) {
    final l10n = AppLocalizations.of(context)!;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final primaryColor = Theme.of(context).primaryColor;
    final controller = context.watch<OrderController>();
    
    // Check if this card was recently updated
    final bool isRecentlyUpdated = controller.lastUpdatedOrderId == (order.id ?? order.orderId);

    return Card(
      elevation: isRecentlyUpdated ? 12 : 0,
      margin: const EdgeInsets.only(bottom: 20),
      color: isDark ? const Color(0xFF1E1E1E) : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
        side: BorderSide(
          color: isRecentlyUpdated ? primaryColor : Colors.grey.withOpacity(0.1),
          width: isRecentlyUpdated ? 2 : 1,
        ),
      ),
      child: Stack(
        children: [
          Padding(
            padding: const EdgeInsets.all(20.0),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('${l10n.orderIdLabel}${order.orderNumber?.split('-').last ?? order.orderId}', 
                      style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: primaryColor.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(order.getDisplayStatus(l10n), 
                        style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: primaryColor)),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                
                if (order.estimatedArrivalAt != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 20),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.timer_outlined, size: 16, color: Colors.orange),
                        const SizedBox(width: 8),
                        Text(
                          StorageService.instance.getLanguageCode() == 'ar' 
                            ? 'الوصول المتوقع: ${order.estimatedArrivalAt!.hour}:${order.estimatedArrivalAt!.minute.toString().padLeft(2, '0')}'
                            : 'ETA: ${order.estimatedArrivalAt!.hour}:${order.estimatedArrivalAt!.minute.toString().padLeft(2, '0')}',
                          style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.orange, fontSize: 14),
                        ),
                      ],
                    ),
                  ),
                
                OrderStatusTracker(status: order.status ?? 'pending'),
                
                const SizedBox(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(l10n.totalAmount, 
                            style: const TextStyle(color: Colors.grey, fontSize: 12),
                            overflow: TextOverflow.ellipsis,
                            maxLines: 1,
                          ),
                          Text('${order.totalPrice.toStringAsFixed(2)} ${l10n.currency}', 
                            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: primaryColor),
                            overflow: TextOverflow.ellipsis,
                            maxLines: 1,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Flexible(
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        child: ElevatedButton.icon(
                          onPressed: () => _showInvoice(order),
                          icon: const Icon(Icons.receipt_long_rounded, size: 18, color: Colors.black),
                          label: Text(l10n.invoiceDetails, 
                            style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: primaryColor,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
                            elevation: 0,
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                if (order.status == 'pending' || order.status == 'confirmed' || order.status == 'preparing')
                  Padding(
                    padding: const EdgeInsets.only(top: 15),
                    child: SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: () => _navigateToCancel(order),
                        icon: const Icon(Icons.cancel_outlined, size: 18, color: Colors.red),
                        label: Text(l10n.cancelOrder, style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold)),
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: Colors.red),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
                        ),
                      ),
                    ),
                  ),

                if (order.cancellationStatus == 'rejected' && order.rejectionReason != null)
                  Container(
                    margin: const EdgeInsets.only(top: 16),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.red.withOpacity(0.05),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: Colors.red.withOpacity(0.1)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.info_outline, color: Colors.red, size: 20),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                StorageService.instance.getLanguageCode() == 'ar' ? 'تم رفض طلب الإلغاء' : 'Cancellation Request Rejected',
                                style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold, fontSize: 13),
                              ),
                              Text(
                                order.rejectionReason!,
                                style: TextStyle(color: Colors.red.withOpacity(0.8), fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          
          // ✨ Status Changed Badge (UX Polish)
          if (isRecentlyUpdated)
            Positioned(
              top: -10,
              left: 20,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: primaryColor,
                  borderRadius: BorderRadius.circular(10),
                  boxShadow: [
                    BoxShadow(color: primaryColor.withOpacity(0.3), blurRadius: 10, offset: const Offset(0, 4))
                  ],
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.bolt, size: 12, color: Colors.black),
                    const SizedBox(width: 4),
                    Text(
                      StorageService.instance.getLanguageCode() == 'ar' ? 'تم التحديث!' : 'Updated!',
                      style: const TextStyle(color: Colors.black, fontSize: 10, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ).animate().shake(duration: 500.ms).scale(begin: const Offset(0.7, 0.7), end: const Offset(1, 1), curve: Curves.elasticOut),
            ),
        ],
      ),
    ).animate(target: isRecentlyUpdated ? 1 : 0)
     .scale(begin: const Offset(1, 1), end: const Offset(1.03, 1.03), duration: 400.ms, curve: Curves.fastOutSlowIn)
     .then()
     .shimmer(duration: 800.ms, color: primaryColor.withOpacity(0.2));
  }

  void _navigateToCancel(OrderModel order) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => CancelOrderReasonScreen(order: order),
      ),
    );
  }

  Widget _buildHistoryOrderCard(OrderModel order) {
    final l10n = AppLocalizations.of(context)!;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 16),
      color: isDark ? const Color(0xFF1A1A1A) : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: Colors.grey.withOpacity(0.1)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${l10n.orderIdLabel}${order.orderNumber?.split('-').last ?? order.orderId}', 
                  style: const TextStyle(fontWeight: FontWeight.bold)),
                Text('${order.timestamp.day}/${order.timestamp.month}/${order.timestamp.year}', 
                  style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${order.totalPrice.toStringAsFixed(2)} ${l10n.currency}', 
                  style: const TextStyle(fontWeight: FontWeight.w900)),
                Row(
                  children: [
                    _buildSmallActionBtn(Icons.star_rounded, Colors.amber, () => _showRatingModal(order), isActive: order.rating != null),
                    const SizedBox(width: 8),
                    _buildSmallActionBtn(Icons.refresh_rounded, Colors.green, () => _reorder(order)),
                    const SizedBox(width: 8),
                    _buildSmallActionBtn(Icons.receipt_rounded, Colors.grey, () => _showInvoice(order)),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSmallActionBtn(IconData icon, Color color, VoidCallback onTap, {bool isActive = false}) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: isActive ? color : color.withOpacity(0.1),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(icon, size: 18, color: isActive ? Colors.white : color),
      ),
    );
  }

  void _reorder(OrderModel order) async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Text(l10n.reorder),
        content: Text(l10n.reorderConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l10n.cancel)),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l10n.confirm)),
        ],
      ),
    );
    if (confirmed == true) {
      final cart = context.read<CartController>();
      await cart.replaceCart(order.cartItems);
      if (mounted) {
        Navigator.push(context, MaterialPageRoute(builder: (_) => const CheckoutScreen()));
      }
    }
  }

  void _showInvoice(OrderModel order) {
    final l10n = AppLocalizations.of(context)!;
    showDialog(
      context: context,
      builder: (ctx) {
        final isDark = Theme.of(ctx).brightness == Brightness.dark;
        return Dialog(
          backgroundColor: Colors.transparent,
          insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 40),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF1E1E1E) : Colors.white,
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: Column(
                    children: [
                      Text(l10n.appName, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
                      Text(l10n.brandSubtitle, style: const TextStyle(fontSize: 14, color: Colors.grey)),
                      if (order.branch != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 4.0),
                          child: Text(order.branch!, style: TextStyle(fontSize: 14, color: Theme.of(ctx).primaryColor, fontWeight: FontWeight.bold)),
                        ),
                      const SizedBox(height: 12),
                      Text('${l10n.orderIdLabel} ${order.orderNumber ?? order.orderId}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                      
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 16),
                        child: DashedLine(),
                      ),

                      ...order.cartItems.map((item) => Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('${item.quantity}x ${item.displayTitle}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                                  if (item.displayOptionsText.isNotEmpty)
                                    Text(item.displayOptionsText, style: const TextStyle(color: Colors.grey, fontSize: 10)),
                                ],
                              ),
                            ),
                            Text(item.totalPrice.toStringAsFixed(2), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                          ],
                        ),
                      )).toList(),
                      
                      const SizedBox(height: 8),
                      Text(
                        StorageService.instance.getLanguageCode() == 'ar' 
                          ? 'الأسعار شاملة ضريبة المبيعات' 
                          : 'Prices are inclusive of sales tax',
                        style: const TextStyle(color: Colors.grey, fontSize: 9, fontWeight: FontWeight.bold),
                      ),

                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 16),
                        child: DashedLine(),
                      ),
                      
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(l10n.totalAmount, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
                          Text('${order.totalPrice.toStringAsFixed(2)} ${l10n.currency}', 
                            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: Theme.of(ctx).primaryColor)),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  height: 54,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: Colors.black,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    ),
                    onPressed: () => Navigator.pop(ctx),
                    child: Text(l10n.close, style: const TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _showRatingModal(OrderModel order) {
    if (order.rating != null) return;
    int currentRating = 5;
    final l10n = AppLocalizations.of(context)!;
    final TextEditingController commentController = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setStateBuilder) => AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: Text(l10n.rateOrder, textAlign: TextAlign.center),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                RatingBar.builder(
                  initialRating: 5,
                  minRating: 1,
                  itemCount: 5,
                  itemBuilder: (context, _) => const Icon(Icons.star, color: Colors.amber),
                  onRatingUpdate: (rating) => setStateBuilder(() => currentRating = rating.toInt()),
                ),
                const SizedBox(height: 20),
                TextField(
                  controller: commentController,
                  maxLines: 3,
                  decoration: InputDecoration(
                    hintText: l10n.ratingHint,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l10n.cancel)),
            ElevatedButton(
              onPressed: () async {
                final success = await context.read<OrderController>().rateOrder(order.orderId, currentRating, commentController.text);
                if (success && mounted) {
                  Navigator.pop(ctx);
                }
              },
              child: Text(l10n.confirm),
            ),
          ],
        ),
      )
    );
  }
}

class OrderStatusTracker extends StatelessWidget {
  final String status;
  const OrderStatusTracker({Key? key, required this.status}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    int step = 0;
    if (status == 'pending') step = 0;
    if (status == 'confirmed' || status == 'preparing') step = 1;
    if (status == 'ready') step = 2;
    if (status == 'in_route' || status == 'delivered') step = 3;

    return Column(
      children: [
        Row(
          children: List.generate(4, (index) {
            bool isCompleted = index <= step;
            bool isCurrent = index == step;
            
            return Expanded(
              child: Row(
                children: [
                  // Dot
                  Container(
                    width: 14, height: 14,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isCompleted ? Colors.orange : (isDark ? Colors.white10 : Colors.grey.shade200),
                    ),
                  ),
                  // Line
                  if (index < 3)
                    Expanded(
                      child: Container(
                        height: 2,
                        color: index < step ? Colors.orange : (isDark ? Colors.white10 : Colors.grey.shade200),
                      ),
                    ),
                ],
              ),
            );
          }),
        ),
        const SizedBox(height: 12),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            _buildLabel(l10n.pending, step >= 0),
            _buildLabel(l10n.preparing, step >= 1),
            _buildLabel(l10n.ready, step >= 2),
            _buildLabel(l10n.delivered, step >= 3),
          ],
        ),
      ],
    );
  }

  Widget _buildLabel(String text, bool active) {
    return Text(
      text,
      style: TextStyle(
        fontSize: 9,
        fontWeight: active ? FontWeight.bold : FontWeight.normal,
        color: active ? Colors.orange : Colors.grey,
      ),
    );
  }
}

class DashedLine extends StatelessWidget {
  final double height;
  final Color color;
  const DashedLine({Key? key, this.height = 1, this.color = Colors.grey}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final boxWidth = constraints.constrainWidth();
        const dashWidth = 5.0;
        final dashCount = (boxWidth / (2 * dashWidth)).floor();
        return Flex(
          children: List.generate(dashCount, (_) => SizedBox(width: dashWidth, height: height, child: DecoratedBox(decoration: BoxDecoration(color: color.withOpacity(0.2))))),
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          direction: Axis.horizontal,
        );
      },
    );
  }
}
