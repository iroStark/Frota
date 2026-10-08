import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../core/format/format.dart';
import '../payments/common.dart';
import 'models.dart';

/// Recibo de pagamento em PDF, partilhável por WhatsApp/email.
Future<Uint8List> buildReceiptPdf({required String driverName, required StatementPayment payment, required int balanceAfter}) async {
  final doc = pw.Document(title: 'Recibo UHOCHA', author: 'UHOCHA');
  pw.Widget row(String label, String value) => pw.Padding(
        padding: const pw.EdgeInsets.symmetric(vertical: 4),
        child: pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [pw.Text(label), pw.Text(value, style: pw.TextStyle(fontWeight: pw.FontWeight.bold))]),
      );
  doc.addPage(pw.Page(
    pageFormat: PdfPageFormat.a5,
    margin: const pw.EdgeInsets.all(32),
    build: (context) => pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
      pw.Text('UHOCHA - Comércio & Prestação de Serviços, Lda.', style: pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold)),
      pw.Text('NIF 5000848280 · Lubango, Huíla', style: const pw.TextStyle(fontSize: 9)),
      pw.SizedBox(height: 24),
      pw.Text('Recibo de pagamento', style: pw.TextStyle(fontSize: 20, fontWeight: pw.FontWeight.bold)),
      pw.Text('N.º ${payment.id.substring(0, 8).toUpperCase()}', style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey700)),
      pw.SizedBox(height: 16),
      row('Motorista', driverName),
      row('Data', formatDateTime(payment.receivedAt)),
      row('Forma de pagamento', paymentMethods[payment.method] ?? (payment.method == 'caucao' ? 'Caução' : payment.method)),
      if (payment.reference != null) row('Referência', payment.reference!),
      pw.Divider(),
      row('Valor recebido', formatKz(payment.amount)),
      row(balanceAfter > 0 ? 'Saldo em dívida' : balanceAfter < 0 ? 'Crédito' : 'Saldo', formatKz(balanceAfter.abs())),
      pw.Spacer(),
      pw.Text('Emitido pela app UHOCHA Frota em ${formatDateTime(DateTime.now())}.', style: const pw.TextStyle(fontSize: 8, color: PdfColors.grey600)),
    ]),
  ));
  return doc.save();
}

Future<void> shareReceipt({required String driverName, required StatementPayment payment, required int balanceAfter}) async {
  final bytes = await buildReceiptPdf(driverName: driverName, payment: payment, balanceAfter: balanceAfter);
  await Printing.sharePdf(bytes: bytes, filename: 'recibo-uhocha-${payment.id.substring(0, 8)}.pdf');
}
