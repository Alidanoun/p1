import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:al_markazia_app/widgets/skeletons/category_skeleton.dart';

void main() {
  testWidgets('CategorySkeleton builds successfully', (WidgetTester tester) async {
    // Build our widget and trigger a frame.
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: CategorySkeleton(),
        ),
      ),
    );
    
    // Verify that the widget is built.
    expect(find.byType(CategorySkeleton), findsOneWidget);
  });
}
