import 'package:flutter_test/flutter_test.dart';
import 'package:uhocha_frota/features/shared/allocation.dart';
import 'package:uhocha_frota/features/shared/models.dart';

StatementCharge charge(String id, String due, int amount, {int paid = 0, String status = 'aberta'}) => StatementCharge.fromJson({
      'id': id, 'kind': 'semanal', 'period_start': '2026-09-14', 'due_at': due, 'amount': amount, 'paid': paid, 'status': status,
    });

void main() {
  final statement = Statement.fromJson({
    'totals': {'balance': 0, 'overdue': 0, 'charged': 0, 'paid': 0},
    'payments': [],
    'charges': [
      charge('s3', '2026-10-05T11:00:00Z', 130000).toJsonForTest(),
      charge('s1', '2026-09-21T11:00:00Z', 86667, paid: 36667, status: 'parcial').toJsonForTest(),
      charge('paga', '2026-09-14T11:00:00Z', 130000, paid: 130000, status: 'paga').toJsonForTest(),
      charge('s2', '2026-09-28T11:00:00Z', 130000).toJsonForTest(),
    ],
  });

  test('ordena as dívidas da mais antiga para a mais recente e ignora as pagas', () {
    expect(openCharges(statement).map((c) => c.id), ['s1', 's2', 's3']);
  });

  test('distribui como o servidor e calcula o crédito', () {
    final preview = previewAllocation(200000, openCharges(statement));
    expect(preview.lines.map((l) => [l.charge.id, l.amount]), [['s1', 50000], ['s2', 130000], ['s3', 20000]]);
    expect(preview.lines.first.settles, isTrue);
    expect(preview.lines.last.settles, isFalse);
    expect(preview.credit, 0);
    expect(previewAllocation(400000, openCharges(statement)).credit, 90000);
  });
}
