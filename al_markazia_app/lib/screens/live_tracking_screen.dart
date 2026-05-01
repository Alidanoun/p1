import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../models/order_model.dart';
import '../services/tracking_service.dart';
import '../theme/design_system.dart';
import '../l10n/generated/app_localizations.dart';

class LiveTrackingScreen extends StatefulWidget {
  final OrderModel order;

  const LiveTrackingScreen({Key? key, required this.order}) : super(key: key);

  @override
  State<LiveTrackingScreen> createState() => _LiveTrackingScreenState();
}

class _LiveTrackingScreenState extends State<LiveTrackingScreen> {
  final Completer<GoogleMapController> _mapController = Completer();
  final TrackingService _trackingService = TrackingService();
  StreamSubscription? _trackingSubscription;

  LatLng? _driverPos;
  double _driverHeading = 0.0;
  
  // Default store location if order doesn't have one (simulation)
  static const LatLng _storeLocation = LatLng(31.9539, 35.9106); 

  @override
  void initState() {
    super.initState();
    _trackingService.init();
    _trackingService.startTrackingOrder(widget.order.orderId);
    
    _trackingSubscription = _trackingService.trackingStream.listen((update) {
      if (mounted) {
        setState(() {
          _driverPos = LatLng(update.lat, update.lng);
          _driverHeading = update.heading;
        });
        _animateCameraToDriver();
      }
    });
  }

  Future<void> _animateCameraToDriver() async {
    if (_driverPos == null) return;
    final GoogleMapController controller = await _mapController.future;
    controller.animateCamera(CameraUpdate.newLatLng(_driverPos!));
  }

  @override
  void dispose() {
    _trackingSubscription?.cancel();
    _trackingService.stopTrackingOrder(widget.order.orderId);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final destPos = widget.order.destLat != null 
        ? LatLng(widget.order.destLat!, widget.order.destLng!)
        : const LatLng(31.9631, 35.9303); // Simulation fallback

    return Scaffold(
      body: Stack(
        children: [
          // 🗺️ The Map
          GoogleMap(
            initialCameraPosition: CameraPosition(
              target: _driverPos ?? _storeLocation,
              zoom: 15,
            ),
            onMapCreated: (controller) => _mapController.complete(controller),
            markers: {
              // Store Marker
              Marker(
                markerId: const MarkerId('store'),
                position: _storeLocation,
                infoWindow: const InfoWindow(title: 'Central Restaurant'),
                icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueOrange),
              ),
              // Destination Marker
              Marker(
                markerId: const MarkerId('destination'),
                position: destPos,
                infoWindow: const InfoWindow(title: 'You'),
                icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
              ),
              // Driver Marker
              if (_driverPos != null)
                Marker(
                  markerId: const MarkerId('driver'),
                  position: _driverPos!,
                  rotation: _driverHeading,
                  icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
                ),
            },
          ),

          // 🔙 Back Button
          Positioned(
            top: 50,
            left: 20,
            child: SafeArea(
              child: GestureDetector(
                onTap: () => Navigator.pop(context),
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    boxShadow: DesignSystem.softShadow(Colors.black),
                  ),
                  child: const Icon(Icons.arrow_back_ios_new, size: 20, color: Colors.black),
                ),
              ),
            ),
          ),

          // 📦 Order Status Panel (Bottom)
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Theme.of(context).cardColor,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(DesignSystem.radiusXL)),
                boxShadow: DesignSystem.hardShadow(Colors.black),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Pull indicator
                  Container(
                    width: 40, height: 4,
                    margin: const EdgeInsets.only(bottom: 20),
                    decoration: BoxDecoration(
                      color: Colors.grey.withOpacity(0.3),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),

                  Row(
                    children: [
                      // Driver Avatar
                      Container(
                        width: 50, height: 50,
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          color: DesignSystem.primary,
                        ),
                        child: const Icon(Icons.delivery_dining_rounded, color: Colors.white),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              l10n.inRoute,
                              style: DesignSystem.heading(context).copyWith(fontSize: 18),
                            ),
                            Text(
                              'أحمد المنصور يقترب منك...',
                              style: DesignSystem.body(context, color: Colors.grey),
                            ),
                          ],
                        ),
                      ),
                      // Pulse effect for "Live"
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.red.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 8, height: 8,
                              decoration: const BoxDecoration(color: Colors.red, shape: BoxShape.circle),
                            ).animate(onPlay: (c) => c.repeat()).scale(duration: 800.ms, begin: const Offset(1,1), end: const Offset(1.5, 1.5)).fade(begin: 1, end: 0),
                            const SizedBox(width: 6),
                            const Text('LIVE', style: TextStyle(color: Colors.red, fontSize: 10, fontWeight: FontWeight.bold)),
                          ],
                        ),
                      ),
                    ],
                  ),
                  
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 20),
                    child: Divider(),
                  ),

                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('الوقت المتوقع', style: DesignSystem.body(context, color: Colors.grey)),
                          const Text('8-12 دقيقة', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                        ],
                      ),
                      ElevatedButton.icon(
                        onPressed: () {}, // Future: Call Driver
                        icon: const Icon(Icons.phone_in_talk_rounded),
                        label: const Text('اتصال'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.green,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ).animate().slideY(begin: 1, end: 0, duration: 600.ms, curve: Curves.easeOutQuart),
          ),
        ],
      ),
    );
  }
}
