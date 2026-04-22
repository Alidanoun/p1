import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:al_markazia_app/features/cart/cart_controller.dart';
import 'package:al_markazia_app/models/cart_item.dart';
import 'package:al_markazia_app/services/storage_service.dart';

class MockStorageService extends Mock implements StorageService {}

void main() {
  late CartController cartController;
  late MockStorageService mockStorage;

  setUpAll(() {
    registerFallbackValue(<CartItem>[]);
  });

  setUp(() {
    mockStorage = MockStorageService();
    
    // Default behaviors
    when(() => mockStorage.getCart()).thenReturn([]);
    when(() => mockStorage.saveCart(any())).thenAnswer((_) async {});
    when(() => mockStorage.clearCart()).thenAnswer((_) async {});

    cartController = CartController(storageService: mockStorage);
  });

  group('CartController - Unit Tests', () {
    test('Initial state: loads from storage', () {
      verify(() => mockStorage.getCart()).called(1);
      expect(cartController.isEmpty, true);
    });

    test('addItem: adds new item and syncs with storage', () async {
      final item = CartItem(
        id: '1_123',
        productId: 1,
        title: 'Burger',
        unitPrice: 10.0,
        image: '',
      );

      await cartController.addItem(item);

      expect(cartController.itemCount, 1);
      expect(cartController.items.first.productId, 1);
      expect(cartController.subtotal, 10.0);
      verify(() => mockStorage.saveCart(any())).called(1);
    });

    test('addItem: increments quantity if item with same options exists', () async {
      final item1 = CartItem(
        id: '1_123',
        productId: 1,
        title: 'Burger',
        unitPrice: 10.0,
        image: '',
        optionsText: 'No Onions',
        quantity: 1,
      );

      final item2 = CartItem(
        id: '1_456',
        productId: 1,
        title: 'Burger',
        unitPrice: 10.0,
        image: '',
        optionsText: 'No Onions',
        quantity: 2,
      );

      await cartController.addItem(item1);
      await cartController.addItem(item2);

      expect(cartController.itemCount, 1);
      expect(cartController.items.first.quantity, 3);
      expect(cartController.subtotal, 30.0);
    });

    test('updateQuantity: updates item and syncs', () async {
       final item = CartItem(id: '1_123', productId: 1, title: 'A', unitPrice: 5.0, image: '', quantity: 1);
       await cartController.addItem(item);
       
       await cartController.updateQuantity(0, 1); // delta +1
       
       expect(cartController.items.first.quantity, 2);
       expect(cartController.subtotal, 10.0);
       verify(() => mockStorage.saveCart(any())).called(2); // once for add, once for update
    });

    test('removeItem: removes item and syncs', () async {
       final item = CartItem(id: '1_123', productId: 1, title: 'A', unitPrice: 5.0, image: '');
       await cartController.addItem(item);
       
       await cartController.removeItem(0);
       
       expect(cartController.isEmpty, true);
       verify(() => mockStorage.saveCart(any())).called(2); // add then save clear
    });

    test('clearCart: clears items and storage', () async {
       final item = CartItem(id: '1_123', productId: 1, title: 'A', unitPrice: 5.0, image: '');
       await cartController.addItem(item);
       
       await cartController.clearCart();
       
       expect(cartController.isEmpty, true);
       verify(() => mockStorage.clearCart()).called(1);
    });
  });
}
