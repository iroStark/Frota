import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:uhocha_frota/features/shared/models.dart';
import 'package:uhocha_frota/features/shared/receipt.dart';

void main() {
  test('recibo em PDF com acentos', () async {
    await initializeDateFormatting('pt_PT');
    final payment = StatementPayment.fromJson({
      'id': '12345678-aaaa-bbbb-cccc-1234567890ab', 'amount': 130000, 'received_at': '2026-10-05T10:00:00Z',
      'method': 'transferencia', 'reference': 'TRF-1',
    });
    final bytes = await buildReceiptPdf(driverName: 'João Manuel', payment: payment, balanceAfter: 0);
    expect(String.fromCharCodes(bytes.take(4)), '%PDF');
    expect(bytes.length, greaterThan(1000));
  });
}
