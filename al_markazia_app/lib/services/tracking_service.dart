import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import '../services/api_service.dart';
import '../services/session_service.dart';

class TrackingUpdate {
  final double lat;
  final double lng;
  final double heading;
  final double speed;
  final int timestamp;

  TrackingUpdate({
    required this.lat,
    required this.lng,
    required this.heading,
    required this.speed,
    required this.timestamp,
  });

  factory TrackingUpdate.fromJson(Map<String, dynamic> json) {
    return TrackingUpdate(
      lat: (json['lat'] as num).toDouble(),
      lng: (json['lng'] as num).toDouble(),
      heading: (json['heading'] as num).toDouble(),
      speed: (json['speed'] as num).toDouble(),
      timestamp: json['timestamp'] as int,
    );
  }
}

class TrackingService {
  static final TrackingService _instance = TrackingService._internal();
  factory TrackingService() => _instance;
  TrackingService._internal();

  IO.Socket? _socket;
  final _trackingController = StreamController<TrackingUpdate>.broadcast();

  Stream<TrackingUpdate> get trackingStream => _trackingController.stream;

  void init() {
    if (_socket != null) return;

    final token = SessionService.instance.rawAccessToken;
    _socket = IO.io(ApiService.baseUrl, 
      IO.OptionBuilder()
        .setTransports(['websocket'])
        .setAuth({'token': token})
        .enableAutoConnect()
        .build()
    );

    _socket!.onConnect((_) => print('🛰️ Tracking Socket Connected'));
    
    _socket!.on('tracking:location_update', (data) {
      _trackingController.add(TrackingUpdate.fromJson(data));
    });
  }

  void startTrackingOrder(String orderId) {
    _socket?.emit('tracking:join', {'orderId': orderId});
  }

  void stopTrackingOrder(String orderId) {
    // Logic to leave the specific room if needed
  }

  void dispose() {
    _socket?.disconnect();
    _socket = null;
    _trackingController.close();
  }
}
