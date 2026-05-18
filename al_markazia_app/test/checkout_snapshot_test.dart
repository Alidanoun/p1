import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:al_markazia_app/features/cart/cart_controller.dart';
import 'package:al_markazia_app/features/checkout/checkout_controller.dart';
import 'package:al_markazia_app/features/auth/auth_controller.dart';
import 'package:al_markazia_app/models/cart_item.dart';
import 'package:al_markazia_app/services/storage_service.dart';
import 'package:al_markazia_app/services/api_service.dart';
import 'package:al_markazia_app/models/order_model.dart';
import 'package:al_markazia_app/l10n/generated/app_localizations.dart';

class MockStorageService extends Mock implements StorageService {}
class MockApiService extends Mock implements ApiService {}
class MockAuthController extends Mock implements AuthController {}
class MockAppLocalizations extends Mock implements AppLocalizations {}

void main() {
  late CartController cartController;
  late CheckoutController checkoutController;
  late MockStorageService mockStorage;
  late MockApiService mockApi;
  late MockAuthController mockAuth;
  late MockAppLocalizations mockL10n;

  setUpAll(() {
    registerFallbackValue(OrderModel(
      orderId: '',
      timestamp: DateTime.now(),
      customerName: '',
      customerPhone: '',
      orderType: '',
      cartItems: [],
      totalPrice: 0.0,
    ));
    registerFallbackValue(CartController(storageService: MockStorageService()));
  });

  setUp(() {
    mockStorage = MockStorageService();
    mockApi = MockApiService();
    mockAuth = MockAuthController();
    mockL10n = MockAppLocalizations();
    
    when(() => mockStorage.getCart()).thenReturn([]);
    when(() => mockStorage.saveCart(any())).thenAnswer((_) async {});
    when(() => mockApi.fetchDeliveryZones()).thenAnswer((_) async => []);
    when(() => mockApi.fetchBranches()).thenAnswer((_) async => []);
    when(() => mockApi.fetchLoyaltyStatus()).thenAnswer((_) async => {});
    
    // Localization mocks
    when(() => mockL10n.cartChangedError).thenReturn('تغيرت محتويات السلة');
    when(() => mockL10n.priceChangedError).thenReturn('تغيرت الأسعار');
    when(() => mockL10n.minOrderError).thenReturn('الحد الأدنى للطلب');

    cartController = CartController(storageService: mockStorage);
    checkoutController = CheckoutController(apiService: mockApi, storageService: mockStorage);
  });

  group('CheckoutController - Snapshot & Integrity Tests', () {
    test('Freeze Test: snapshot remains unchanged after live cart modification', () async {
      final item1 = CartItem(id: '1', productId: 1, title: 'Item 1', unitPrice: 10.0, image: '');
      await cartController.addItem(item1);

      // Take Snapshot
      checkoutController.initialize(cartController);
      expect(checkoutController.snapshotItems.length, 1);
      expect(checkoutController.subtotal, 10.0);

      // Modify Live Cart
      final item2 = CartItem(id: '2', productId: 2, title: 'Item 2', unitPrice: 20.0, image: '');
      await cartController.addItem(item2);
      
      expect(cartController.itemCount, 2);
      expect(cartController.subtotal, 30.0);

      // ❄️ VERIFY SNAPSHOT IS STILL FROZEN
      expect(checkoutController.snapshotItems.length, 1, reason: 'Snapshot should not increase');
      expect(checkoutController.subtotal, 10.0, reason: 'Snapshot subtotal should not change');
    });

    test('Validation: confirmOrder fails if live cart length differs from snapshot', () async {
      final item1 = CartItem(id: '1', productId: 1, title: 'I1', unitPrice: 10.0, image: '');
      await cartController.addItem(item1);

      checkoutController.initialize(cartController);

      // Modify Live Cart (Add another)
      await cartController.addItem(CartItem(id: '2', productId: 2, title: 'I2', unitPrice: 5.0, image: ''));

      final result = await checkoutController.confirmOrder(cartController, mockAuth, mockL10n);

      expect(result, isNull);
      expect(checkoutController.errorMessage, contains('تغيرت محتويات السلة'));
      verifyNever(() => mockApi.placeOrder(any()));
    });

    test('Validation: confirmOrder fails if live cart subtotal differs from snapshot (Price Drift)', () async {
      final item1 = CartItem(id: '1', productId: 1, title: 'I1', unitPrice: 10.0, image: '');
      await cartController.addItem(item1);

      checkoutController.initialize(cartController);

      // Simulate price drift in live cart
      cartController.items.first.quantity = 2; // subtotal becomes 20

      final result = await checkoutController.confirmOrder(cartController, mockAuth, mockL10n);

      expect(result, isNull);
      expect(checkoutController.errorMessage, contains('تغيرت الأسعار'));
    });

    test('Success Flow: clears live cart on successful order', () async {
      final item1 = CartItem(id: '1', productId: 1, title: 'I1', unitPrice: 10.0, image: '');
      await cartController.addItem(item1);
      
      checkoutController.initialize(cartController);
      
      when(() => mockApi.placeOrder(any())).thenAnswer((_) async => OrderModel(
        orderId: 'ORD-1',
        timestamp: DateTime.now(),
        customerName: 'Test',
        customerPhone: '123',
        orderType: 'delivery',
        cartItems: [],
        totalPrice: 10.0,
      ));
      when(() => mockStorage.saveOrder(any())).thenAnswer((_) async {});
      when(() => mockStorage.clearCart()).thenAnswer((_) async {});
      when(() => mockAuth.refreshProfile()).thenAnswer((_) async {});

      final result = await checkoutController.confirmOrder(cartController, mockAuth, mockL10n);

      expect(result, isNotNull);
      expect(cartController.isEmpty, true, reason: 'Live cart should be cleared after success');
      verify(() => mockApi.placeOrder(any())).called(1);
      verify(() => mockAuth.refreshProfile()).called(1);
    });
  });
}
