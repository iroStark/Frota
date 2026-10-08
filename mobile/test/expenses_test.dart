import 'package:flutter_test/flutter_test.dart';
import 'package:uhocha_frota/features/operations/expenses_screen.dart';

void main() {
  test('dividir um total não perde kwanzas (igual ao servidor)', () {
    expect(splitTotal(100000, 3), [33334, 33333, 33333]);
    expect(splitTotal(90000, 3), [30000, 30000, 30000]);
    expect(splitTotal(1234567, 7).fold<int>(0, (a, b) => a + b), 1234567);
    expect(splitTotal(1000, 0), isEmpty);
  });
}
