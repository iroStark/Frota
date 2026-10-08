import 'package:flutter/material.dart';

import '../../app/theme.dart';
import '../../core/format/format.dart';
import '../../core/widgets/widgets.dart';
import '../payments/common.dart';
import 'models.dart';
import 'receipt.dart';

Tone chargeTone(String status, {bool overdue = false}) => switch (status) {
      'paga' => Tone.ok,
      'isenta' => Tone.neutral,
      'parcial' => Tone.warn,
      _ => overdue ? Tone.danger : Tone.warn,
    };

String chargeStatusLabel(String status) => const {
      'aberta': 'Em falta',
      'parcial': 'Parcial',
      'paga': 'Paga',
      'isenta': 'Isenta',
      'anulada': 'Anulada',
    }[status] ??
    status;

List<String> chargeDetails(StatementCharge charge) => [
      if (charge.calculation != null) charge.calculation!.summary,
      if (charge.calculation != null && charge.calculation!.chargedDays != charge.calculation!.workingDays)
        '${charge.calculation!.chargedDays} × ${formatKz(charge.calculation!.dailyRate)}',
      if (charge.description != null) charge.description!,
      if (charge.outstanding > 0 && charge.status != 'isenta') 'Falta ${formatKz(charge.outstanding)}',
    ];

/// Conta corrente: saldo, cobranças (com o cálculo por dias) e pagamentos. Usado pelo motorista
/// (Pagamentos) e pelo gestor (ficha do motorista).
List<Widget> statementWidgets(BuildContext context, Statement statement, {String? driverName}) {
  final now = DateTime.now();
  return [
    Row(children: [
      Expanded(
        child: KpiCard(
          label: statement.balance > 0 ? 'Saldo em dívida' : statement.balance < 0 ? 'Crédito' : 'Saldo',
          value: formatKz(statement.balance.abs()),
          highlight: statement.balance <= 0,
          caption: statement.overdue > 0 ? 'Em atraso: ${formatKz(statement.overdue)}' : null,
        ),
      ),
      const SizedBox(width: 12),
      Expanded(child: KpiCard(label: 'Pago no total', value: formatKz(statement.paid))),
    ]),
    const SectionHeader('Cobranças'),
    if (statement.charges.isEmpty) const EmptyState('Ainda sem cobranças.'),
    ...statement.charges.map((charge) {
      final details = chargeDetails(charge);
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Card(
          child: ListTile(
            title: Text(charge.title, style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: details.isEmpty ? null : Text(details.join('\n')),
            isThreeLine: details.length > 1,
            trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(formatKz(charge.amount), style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              StatusChip(chargeStatusLabel(charge.status), tone: chargeTone(charge.status, overdue: charge.dueAt.isBefore(now))),
            ]),
          ),
        ),
      );
    }),
    const SectionHeader('Pagamentos recebidos'),
    if (statement.payments.isEmpty) const EmptyState('Ainda sem pagamentos.'),
    ...statement.payments.map((payment) => Card(
          margin: const EdgeInsets.only(bottom: 8),
          child: ListTile(
            leading: const Icon(Icons.check_circle, color: Brand.ok),
            title: Text(formatKz(payment.amount), style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text([
              formatDateTime(payment.receivedAt),
              paymentMethods[payment.method] ?? (payment.method == 'caucao' ? 'Caução' : payment.method),
              if (payment.reference != null) payment.reference!,
            ].join(' · ')),
            trailing: IconButton(
              tooltip: 'Recibo em PDF',
              icon: const Icon(Icons.picture_as_pdf_outlined),
              onPressed: () => shareReceipt(driverName: driverName ?? '', payment: payment, balanceAfter: statement.balance),
            ),
          ),
        )),
  ];
}
