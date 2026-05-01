import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/order_model.dart';
import '../models/cart_item.dart';
import '../features/cart/cart_controller.dart';
import '../features/checkout/checkout_controller.dart';
import '../features/checkout/models/delivery_zone.dart';
import '../widgets/custom_snackbar.dart';
import 'main_nav_screen.dart';
import 'auth_screen.dart';
import '../features/auth/auth_controller.dart';
import '../l10n/generated/app_localizations.dart';
import 'order_success_screen.dart';

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({Key? key}) : super(key: key);

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}


class _CheckoutScreenState extends State<CheckoutScreen> {
  final _formKey = GlobalKey<FormState>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final cart = context.read<CartController>();
      context.read<CheckoutController>().initialize(cart);
    });
  }

  void _confirmOrder() async {
    final checkout = context.read<CheckoutController>();
    final cart = context.read<CartController>();
    final auth = context.read<AuthController>();
    final l10n = AppLocalizations.of(context)!;

    if (!auth.isAuthenticated) {
      if (mounted) {
        showCustomSnackbar(context, l10n.loginTitle, isSuccess: false);
      }
      return;
    }

    if (_formKey.currentState!.validate()) {
      _formKey.currentState!.save();

      if (checkout.orderType == 'delivery' && checkout.selectedZone == null) {
        showCustomSnackbar(context, l10n.selectZoneError, isSuccess: false);
        return;
      }

      if (checkout.selectedBranch == null) {
        showCustomSnackbar(context, l10n.branchRequired, isSuccess: false);
        return;
      }

      final sentOrder = await checkout.confirmOrder(cart, l10n);

      if (sentOrder != null) {
        if (mounted) {
          Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(builder: (_) => OrderSuccessScreen(order: sentOrder)),
            (route) => false,
          );
        }
      } else if (checkout.errorMessage != null) {
        if (mounted) {
          showCustomSnackbar(context, checkout.errorMessage!, isSuccess: false);
        }
      }
    }
  }


  Future<void> _selectTime(BuildContext context) async {
    final TimeOfDay? picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.now(),
    );
    if (picked != null) {
      context.read<CheckoutController>().updateSelectedTime(picked);
    }
  }

  void _showZonesBottomSheet(BuildContext context) {
    String searchQuery = '';
    final checkout = context.read<CheckoutController>();
    
    // Use dynamic zones from controller
    final sortedZones = List<DeliveryZone>.from(checkout.zones);
    sortedZones.sort((a, b) => a.nameAr.compareTo(b.nameAr));

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        final l10n = AppLocalizations.of(context)!;
        return StatefulBuilder(
          builder: (context, setModalState) {
            final filteredZones = sortedZones.where((zone) {
              return zone.name.toLowerCase().contains(searchQuery.toLowerCase());
            }).toList();

            return Container(
              height: MediaQuery.of(context).size.height * 0.75,
              decoration: BoxDecoration(
                color: Theme.of(context).scaffoldBackgroundColor,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
              ),
              child: Column(
                children: [
                   // Handle
                  Container(
                    margin: const EdgeInsets.only(top: 12),
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.grey.withOpacity(0.3),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 16, 12, 12),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          AppLocalizations.of(context)!.selectZoneHint,
                          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                        ),
                        IconButton(
                          icon: const Icon(Icons.close),
                          onPressed: () => Navigator.pop(context),
                        ),
                      ],
                    ),
                  ),

                  // Search Bar
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                    child: Container(
                      decoration: BoxDecoration(
                        color: Theme.of(context).brightness == Brightness.dark 
                            ? Colors.white.withOpacity(0.05) 
                            : Colors.grey[100],
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: TextField(
                        onChanged: (value) {
                          setModalState(() {
                            searchQuery = value;
                          });
                        },
                        decoration: InputDecoration(
                          hintText: AppLocalizations.of(context)!.searchZoneHint,
                          prefixIcon: const Icon(Icons.search, color: Colors.orange),
                          border: InputBorder.none,
                          contentPadding: const EdgeInsets.symmetric(vertical: 14),
                          suffixIcon: searchQuery.isNotEmpty 
                            ? IconButton(
                                icon: const Icon(Icons.clear, size: 18),
                                onPressed: () {
                                  setModalState(() {
                                    searchQuery = '';
                                  });
                                },
                              )
                            : null,
                        ),
                      ),
                    ),
                  ),
                  
                  const SizedBox(height: 12),
                  const Divider(height: 1),

                  Expanded(
                    child: filteredZones.isEmpty 
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.location_off_outlined, size: 48, color: Colors.grey[400]),
                              const SizedBox(height: 16),
                              Text(
                                AppLocalizations.of(context)!.noZonesFound,
                                style: TextStyle(color: Colors.grey[500], fontSize: 16),
                              ),
                            ],
                          ),
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                          itemCount: filteredZones.length,
                          separatorBuilder: (context, index) => Divider(
                            height: 1, 
                            indent: 20, 
                            endIndent: 20,
                            color: Colors.grey.withOpacity(0.1),
                          ),
                          itemBuilder: (context, index) {
                            final zone = filteredZones[index];
                            final isSelected = checkout.selectedZone?.id == zone.id;
                            final isBelowMin = zone.minOrder != null && (checkout.subtotal < zone.minOrder!);

                            return InkWell(
                              onTap: () {
                                checkout.setZone(zone);
                                Navigator.pop(context);
                              },
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                                color: isSelected ? Colors.orange.withOpacity(0.05) : null,
                                child: Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.all(8),
                                      decoration: BoxDecoration(
                                        color: isSelected ? Colors.orange : Colors.grey.withOpacity(0.1),
                                        shape: BoxShape.circle,
                                      ),
                                      child: Icon(
                                        Icons.location_on, 
                                        size: 16, 
                                        color: isSelected ? Colors.white : Colors.grey,
                                      ),
                                    ),
                                    const SizedBox(width: 16),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            zone.nameAr,
                                            style: TextStyle(
                                              fontSize: 15,
                                              fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                                            ),
                                          ),
                                          if (zone.nameEn != null && zone.nameEn!.isNotEmpty)
                                            Text(
                                              zone.nameEn!,
                                              style: TextStyle(fontSize: 11, color: Colors.grey[500]),
                                            ),
                                          if (zone.minOrder != null)
                                            Padding(
                                              padding: const EdgeInsets.only(top: 4.0),
                                              child: Text(
                                                '${l10n.minOrderWarningPrefix} ${zone.minOrder!.toStringAsFixed(2)}',
                                                style: TextStyle(
                                                  fontSize: 10, 
                                                  color: isBelowMin ? Colors.red : Colors.grey[600],
                                                  fontWeight: isBelowMin ? FontWeight.bold : FontWeight.normal,
                                                ),
                                              ),
                                            ),
                                        ],
                                      ),
                                    ),
                                    Text(
                                      '${zone.fee.toStringAsFixed(2)} ${AppLocalizations.of(context)!.currency}',
                                      style: TextStyle(
                                        color: Colors.orange,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 14,
                                      ),
                                      textDirection: TextDirection.rtl,
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final checkout = context.watch<CheckoutController>();

    return Scaffold(
      appBar: AppBar(title: Text(AppLocalizations.of(context)!.confirmOrder)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Welcome Customer
              Card(
                color: Theme.of(context).primaryColor.withOpacity(0.1),
                elevation: 0,
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Row(
                    children: [
                      const Icon(Icons.person, color: Colors.orange),
                      const SizedBox(width: 12),
                      Text('${l10n.welcome}، ${checkout.customerName.isNotEmpty ? checkout.customerName : l10n.guest}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 24),

              // Order Type
              Text(l10n.orderTypeLabel, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 8),
              Row(
                children: [
                  _buildOrderTypeChip(l10n.delivery, 'delivery', checkout),
                  _buildOrderTypeChip(l10n.takeaway, 'takeaway', checkout),
                ],
              ),

              const SizedBox(height: 16),

              // Branch Selection
              Text(l10n.selectBranch, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 8),
              Row(
                children: [
                  _buildBranchChip(l10n.branchMadina, l10n.branchMadina, checkout),
                  const SizedBox(width: 8),
                  _buildBranchChip(l10n.branchKhalda, l10n.branchKhalda, checkout),
                ],
              ),

              const SizedBox(height: 16),

              // Dynamic Order Details Content
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      TextFormField(
                        initialValue: checkout.customerName,
                        decoration: InputDecoration(labelText: l10n.nameLabel, border: const OutlineInputBorder()),
                        validator: (val) => (val == null || val.isEmpty) ? l10n.nameRequired : null,
                        onSaved: (val) => checkout.customerName = val!,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        initialValue: checkout.customerPhone,
                        keyboardType: TextInputType.phone,
                        decoration: InputDecoration(labelText: l10n.phoneLabel, border: const OutlineInputBorder()),
                        validator: (val) => (val == null || val.isEmpty) ? l10n.phoneRequired : null,
                        onSaved: (val) => checkout.customerPhone = val!,
                      ),
                      const SizedBox(height: 24),
                      
                      const Divider(),
                      const SizedBox(height: 8),

                      if (checkout.orderType == 'delivery') ...[
                        Container(
                          padding: const EdgeInsets.all(20),
                          decoration: BoxDecoration(
                            color: Theme.of(context).cardTheme.color,
                            borderRadius: BorderRadius.circular(16),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withOpacity(0.04),
                                blurRadius: 10,
                                offset: const Offset(0, 4),
                              ),
                            ],
                            border: Border.all(color: Colors.grey.withOpacity(0.1)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(l10n.deliveryAddress, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                                ],
                              ),
                              const SizedBox(height: 16),
                              
                              Text(l10n.zoneLabel, style: TextStyle(color: Theme.of(context).textTheme.bodyLarge?.color?.withOpacity(0.7) ?? Colors.grey[700], fontSize: 13, fontWeight: FontWeight.bold)),
                              const SizedBox(height: 8),
                              
                              InkWell(
                                onTap: () => _showZonesBottomSheet(context),
                                borderRadius: BorderRadius.circular(12),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                                  decoration: BoxDecoration(
                                    color: Theme.of(context).brightness == Brightness.dark ? Theme.of(context).scaffoldBackgroundColor : Colors.white,
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(color: Colors.grey.withOpacity(0.2)),
                                  ),
                                  child: Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Expanded(
                                        child: Text(
                                          checkout.selectedZone != null ? checkout.selectedZone!.name : l10n.selectZoneHint,
                                          style: TextStyle(
                                            color: checkout.selectedZone != null 
                                              ? (Theme.of(context).textTheme.bodyLarge?.color ?? Colors.black)
                                              : Colors.grey[500],
                                            fontSize: 14,
                                          ),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                      const Icon(Icons.keyboard_arrow_down, color: Colors.grey),
                                    ],
                                  ),
                                ),
                              ),
                              
                              const SizedBox(height: 16),
                              
                              Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(AppLocalizations.of(context)!.streetLabel, style: TextStyle(color: Theme.of(context).textTheme.bodyLarge?.color?.withOpacity(0.7) ?? Colors.grey[700], fontSize: 13, fontWeight: FontWeight.bold)),
                                        const SizedBox(height: 8),
                                        TextFormField(
                                          decoration: InputDecoration(
                                            hintText: l10n.streetLabel,
                                            hintStyle: TextStyle(color: Colors.grey[400], fontSize: 14),
                                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: Colors.grey.withOpacity(0.2))),
                                            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: Colors.grey.withOpacity(0.2))),
                                            filled: true,
                                            fillColor: Theme.of(context).cardTheme.color,
                                          ),
                                          onSaved: (val) => checkout.street = val ?? '',
                                          validator: (val) => checkout.orderType == 'delivery' && (val == null || val.isEmpty) ? l10n.streetLabel : null,
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 16),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(l10n.buildingLabel, style: TextStyle(color: Theme.of(context).textTheme.bodyLarge?.color?.withOpacity(0.7) ?? Colors.grey[700], fontSize: 13, fontWeight: FontWeight.bold)),
                                        const SizedBox(height: 8),
                                        TextFormField(
                                          decoration: InputDecoration(
                                            hintText: '${l10n.buildingLabel}...',
                                            hintStyle: TextStyle(color: Colors.grey[400], fontSize: 14),
                                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: Colors.grey.withOpacity(0.2))),
                                            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: Colors.grey.withOpacity(0.2))),
                                            filled: true,
                                            fillColor: Theme.of(context).cardTheme.color,
                                          ),
                                          onSaved: (val) => checkout.building = val ?? '',
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                              
                            ],
                          ),
                        ),
                      ],

                      if (checkout.orderType == 'takeaway') ...[
                        Text(l10n.pickupTimeLabel, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                        const SizedBox(height: 12),
                        Column(
                          children: [
                            RadioListTile<String>(
                              title: Text(l10n.asap),
                              value: 'asap',
                              groupValue: checkout.pickupTiming,
                              activeColor: Theme.of(context).primaryColor,
                              onChanged: (val) => checkout.updatePickupTiming(val!),
                            ),
                            RadioListTile<String>(
                              title: Text(l10n.atTime),
                              value: 'atTime',
                              groupValue: checkout.pickupTiming,
                              activeColor: Theme.of(context).primaryColor,
                              onChanged: (val) => checkout.updatePickupTiming(val!),
                            ),
                          ],
                        ),
                        if (checkout.pickupTiming == 'atTime')
                          Padding(
                            padding: const EdgeInsets.only(left: 32, right: 16),
                            child: OutlinedButton.icon(
                              onPressed: () => _selectTime(context),
                              icon: const Icon(Icons.access_time),
                              label: Text(checkout.selectedTime != null ? checkout.selectedTime!.format(context) : l10n.selectTime),
                            ),
                          ),
                        const SizedBox(height: 16),
                        TextFormField(
                          decoration: InputDecoration(labelText: l10n.notes, border: const OutlineInputBorder(), hintText: l10n.notesHint),
                          onSaved: (val) => checkout.notes = val ?? '',
                        ),
                      ],
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 24),

              // Order Summary Card
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(l10n.orderSummary, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      const SizedBox(height: 12),
                      
                      ...checkout.snapshotItems.map((item) => Padding(
                        padding: const EdgeInsets.only(bottom: 8.0),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text('${item.quantity}x ${item.displayTitle}'),
                            Text('${item.totalPrice.toStringAsFixed(2)} ${l10n.currency}')
                          ],
                        ),
                      )),
                      
                      const Divider(height: 32),
                      
                      // 🎁 Loyalty Points Preview
                      if (checkout.estimatedPoints > 0)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 16.0),
                          child: Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: Colors.amber.withOpacity(0.1),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: Colors.amber.withOpacity(0.3)),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.card_giftcard, color: Colors.amber, size: 20),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        Localizations.localeOf(context).languageCode == 'ar' 
                                          ? 'ستحصل على ${checkout.estimatedPoints} نقطة' 
                                          : 'You will earn ${checkout.estimatedPoints} points',
                                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.amber),
                                      ),
                                      if (checkout.loyaltyConfig?['happyHourStatus']?['isActive'] == true)
                                        Text(
                                          Localizations.localeOf(context).languageCode == 'ar' 
                                            ? 'بما في ذلك مكافأة ساعة السعادة! 🔥' 
                                            : 'Including Happy Hour bonus! 🔥',
                                          style: TextStyle(fontSize: 10, color: Colors.amber.shade700),
                                        ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),

                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(l10n.subtotal),
                          Text('${checkout.subtotal.toStringAsFixed(2)} ${l10n.currency}'),
                        ],
                      ),
                      if (checkout.orderType == 'delivery')
                        Padding(
                          padding: const EdgeInsets.only(top: 8.0),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(l10n.deliveryFee),
                              Text('${checkout.deliveryFee.toStringAsFixed(2)} ${l10n.currency}'),
                            ],
                          ),
                        ),
                      if (checkout.pointsDiscount > 0)
                        Padding(
                          padding: const EdgeInsets.only(top: 8.0),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                Localizations.localeOf(context).languageCode == 'ar' ? 'خصم النقاط' : 'Points Discount',
                                style: const TextStyle(color: Colors.green, fontWeight: FontWeight.bold),
                              ),
                              Text(
                                '-${checkout.pointsDiscount.toStringAsFixed(2)} ${l10n.currency}',
                                style: const TextStyle(color: Colors.green, fontWeight: FontWeight.bold),
                              ),
                            ],
                          ),
                        ),
                      const SizedBox(height: 16),
                      
                      // 💳 Use Points to Pay Toggle
                      if (checkout.availablePoints >= (checkout.loyaltyConfig?['minPointsToRedeem'] ?? 500))
                        Padding(
                          padding: const EdgeInsets.only(bottom: 16.0),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                            decoration: BoxDecoration(
                              color: checkout.usePoints ? Colors.green.withOpacity(0.1) : Colors.grey.withOpacity(0.05),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: checkout.usePoints ? Colors.green.withOpacity(0.3) : Colors.grey.withOpacity(0.2)),
                            ),
                            child: Row(
                              children: [
                                Icon(Icons.wallet_giftcard, color: checkout.usePoints ? Colors.green : Colors.grey, size: 24),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Text(
                                        Localizations.localeOf(context).languageCode == 'ar' 
                                          ? 'استخدم ${checkout.availablePoints} نقطة للخصم' 
                                          : 'Use ${checkout.availablePoints} points for discount',
                                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: checkout.usePoints ? Colors.green : Theme.of(context).textTheme.bodyLarge?.color),
                                      ),
                                    ],
                                  ),
                                ),
                                Switch(
                                  value: checkout.usePoints,
                                  onChanged: (val) => checkout.toggleUsePoints(val),
                                  activeColor: Colors.green,
                                ),
                              ],
                            ),
                          ),
                        )
                      else if (checkout.loyaltyConfig != null && (checkout.loyaltyConfig!['minPointsToRedeem'] ?? 500) > 0 && checkout.availablePoints > 0)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 16.0),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Icons.info_outline, size: 14, color: Colors.grey),
                              const SizedBox(width: 4),
                              Text(
                                Localizations.localeOf(context).languageCode == 'ar' 
                                  ? 'اجمع ${(checkout.loyaltyConfig!['minPointsToRedeem'] ?? 500) - checkout.availablePoints} نقطة إضافية لتتمكن من استخدامها كخصم نقدي!'
                                  : 'Collect ${(checkout.loyaltyConfig!['minPointsToRedeem'] ?? 500) - checkout.availablePoints} more points to use as cash discount!',
                                style: TextStyle(color: Colors.grey.shade500, fontSize: 11),
                                textAlign: TextAlign.center,
                              ),
                            ],
                          ),
                        ),

                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(l10n.finalTotal, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                          Text('${checkout.total.toStringAsFixed(2)} ${l10n.currency}', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 22, color: Theme.of(context).primaryColor)),
                        ],
                      ),
                    ],
                  ),
                ),
              ),

              if (checkout.getMinOrderWarning(l10n) != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16.0),
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.red.withOpacity(0.05),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.red.withOpacity(0.2)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.error_outline, color: Colors.red, size: 20),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            checkout.getMinOrderWarning(l10n)!,
                            style: const TextStyle(color: Colors.red, fontSize: 13, fontWeight: FontWeight.bold),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

              const SizedBox(height: 12),
              Center(
                child: Text(
                  Localizations.localeOf(context).languageCode == 'ar' 
                    ? 'الأسعار شاملة ضريبة المبيعات' 
                    : 'Prices are inclusive of sales tax',
                  style: TextStyle(color: Colors.grey.shade600, fontSize: 12, fontWeight: FontWeight.bold),
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: (checkout.isLoading || !checkout.isMinOrderSatisfied) ? null : _confirmOrder,
                  style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
                  child: checkout.isLoading 
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                    : Text(l10n.confirmOrderNow, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                ),
              )
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBranchChip(String label, String value, CheckoutController checkout) {
    final isSelected = checkout.selectedBranch == value;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (val) {
        if (val) checkout.setBranch(value);
      },
      selectedColor: Theme.of(context).primaryColor.withOpacity(0.2),
      labelStyle: TextStyle(
        color: isSelected ? Theme.of(context).primaryColor : (Theme.of(context).textTheme.bodyLarge?.color),
        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
      ),
    );
  }

  Widget _buildOrderTypeChip(String label, String value, CheckoutController checkout) {
    final isSelected = checkout.orderType == value;
    return Padding(
      padding: const EdgeInsets.only(left: 12),
      child: ChoiceChip(
        label: Text(label),
        selected: isSelected,
        onSelected: (val) {
          if (val) checkout.setOrderType(value);
        },
        selectedColor: Theme.of(context).primaryColor.withOpacity(0.2),
        labelStyle: TextStyle(
          color: isSelected ? Theme.of(context).primaryColor : (Theme.of(context).textTheme.bodyLarge?.color),
          fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
        ),
      ),
    );
  }
}
