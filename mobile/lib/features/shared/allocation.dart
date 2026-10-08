import 'models.dart';

class AllocationLine {
  AllocationLine(this.charge, this.amount);

  final StatementCharge charge;
  final int amount;

  bool get settles => amount >= charge.outstanding;
}

class AllocationPreview {
  AllocationPreview(this.lines, this.credit);

  final List<AllocationLine> lines;
  final int credit;
}

/// Cobranças em dívida, das mais antigas para as mais recentes (a ordem em que o servidor aloca).
List<StatementCharge> openCharges(Statement statement) => statement.charges
    .where((charge) => (charge.status == 'aberta' || charge.status == 'parcial') && charge.outstanding > 0)
    .toList()
  ..sort((a, b) => a.dueAt.compareTo(b.dueAt));

/// Mesma regra do servidor (domain/charges.ts → allocatePayment): paga primeiro o mais antigo.
AllocationPreview previewAllocation(int amount, List<StatementCharge> open) {
  var remaining = amount;
  final lines = <AllocationLine>[];
  for (final charge in open) {
    if (remaining <= 0) break;
    final value = remaining < charge.outstanding ? remaining : charge.outstanding;
    lines.add(AllocationLine(charge, value));
    remaining -= value;
  }
  return AllocationPreview(lines, remaining > 0 ? remaining : 0);
}
