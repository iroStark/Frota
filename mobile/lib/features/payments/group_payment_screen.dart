import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import '../../core/api/api_error.dart';
import '../../core/offline/outbox.dart';
import '../../core/format/format.dart';
import '../../core/widgets/photo_field.dart';
import '../../core/widgets/widgets.dart';
import '../shared/models.dart';
import '../shared/providers.dart';
import 'common.dart';

/// Segunda-feira: vários motoristas entregam de uma vez (ex.: um depósito conjunto).
/// Lista quem ainda deve a semana; cada valor é editável. Tudo é gravado numa só operação.
class GroupPaymentScreen extends ConsumerStatefulWidget {
  const GroupPaymentScreen({super.key});

  @override
  ConsumerState<GroupPaymentScreen> createState() => _GroupPaymentScreenState();
}

class _Row {
  _Row(this.charge) : amount = TextEditingController(text: groupKz(charge.outstanding));

  final WeekCharge charge;
  final TextEditingController amount;
  final clientId = const Uuid().v4();
  bool selected = false;
}

class _GroupPaymentScreenState extends ConsumerState<GroupPaymentScreen> {
  List<_Row>? _rows;
  String _method = 'deposito';
  DateTime _receivedAt = DateTime.now();
  final _reference = TextEditingController();
  XFile? _photo;
  bool _busy = false;

  @override
  void dispose() {
    for (final row in _rows ?? const <_Row>[]) {
      row.amount.dispose();
    }
    _reference.dispose();
    super.dispose();
  }

  int get _total => (_rows ?? const <_Row>[]).where((row) => row.selected).fold(0, (sum, row) => sum + parseKz(row.amount.text));

  Future<void> _submit() async {
    final chosen = (_rows ?? const <_Row>[]).where((row) => row.selected && parseKz(row.amount.text) > 0).toList();
    if (chosen.isEmpty) {
      showMessage(context, 'Escolha pelo menos um motorista com valor.');
      return;
    }
    setState(() => _busy = true);
    try {
      final result = await ref.read(outboxProvider.notifier).submit(
        path: '/payments/batch',
        label: 'Entrega em grupo (${chosen.length}): ${formatKz(_total)}',
        body: {
          'receivedAt': _receivedAt.toUtc().toIso8601String(),
          'method': _method,
          'reference': _reference.text.trim().isEmpty ? null : _reference.text.trim(),
          'items': [
            for (final row in chosen) {'driverId': row.charge.driverId, 'amount': parseKz(row.amount.text), 'clientId': row.clientId},
          ],
        },
        files: [if (_photo != null) OutboxFile(field: 'proofFileId', path: _photo!.path, category: 'entrega-comprovativo')],
      );
      for (final row in chosen) {
        invalidateMoney(ref, driverId: row.charge.driverId);
      }
      if (!mounted) return;
      showMessage(context, result == SubmitResult.queued
          ? 'Sem rede: ${chosen.length} pagamento(s) guardado(s) e enviado(s) quando houver ligação.'
          : '${chosen.length} pagamento(s) registado(s): ${formatKz(_total)}.');
      context.pop();
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dashboard = ref.watch(dashboardProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Entrega em grupo')),
      body: dashboard.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => ErrorRetry(error: error, onRetry: () => ref.invalidate(dashboardProvider)),
        data: (cached) {
          _rows ??= cached.data.weekCharges.where((charge) => charge.outstanding > 0 && charge.status != 'isenta').map(_Row.new).toList();
          final rows = _rows!;
          return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
            Text('Semana ${formatWeek(cached.data.periodStart)}', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            if (rows.isEmpty) const EmptyState('Ninguém deve esta semana.', icon: Icons.check_circle_outline),
            if (rows.isNotEmpty)
              CheckboxListTile(
                title: const Text('Selecionar todos'),
                value: rows.every((row) => row.selected) ? true : rows.any((row) => row.selected) ? null : false,
                tristate: true,
                onChanged: (value) => setState(() {
                  for (final row in rows) {
                    row.selected = value ?? false;
                  }
                }),
              ),
            for (final row in rows)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(4, 4, 16, 4),
                  child: Row(children: [
                    Checkbox(value: row.selected, onChanged: (value) => setState(() => row.selected = value ?? false)),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(row.charge.driverName, style: const TextStyle(fontWeight: FontWeight.w600)),
                        Text('Deve ${formatKz(row.charge.outstanding)}', style: Theme.of(context).textTheme.bodySmall),
                      ]),
                    ),
                    SizedBox(
                      width: 150,
                      child: TextField(
                        controller: row.amount,
                        enabled: row.selected,
                        keyboardType: TextInputType.number,
                        inputFormatters: [FilteringTextInputFormatter.digitsOnly, KzInputFormatter()],
                        textAlign: TextAlign.end,
                        decoration: const InputDecoration(suffixText: 'Kz', isDense: true),
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                  ]),
                ),
              ),
            const SectionHeader('Como foi pago'),
            MethodPicker(value: _method, onChanged: (value) => setState(() => _method = value)),
            DateTimeField(label: 'Recebido em', value: _receivedAt, lastDate: DateTime.now(), onChanged: (value) => setState(() => _receivedAt = value)),
            TextField(controller: _reference, decoration: const InputDecoration(labelText: 'Referência (opcional)')),
            const SizedBox(height: 12),
            PhotoField(label: 'Foto do comprovativo', value: _photo, onChanged: (file) => setState(() => _photo = file)),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _busy || _total == 0 ? null : _submit,
              child: Text(_busy ? 'A guardar…' : 'Registar ${formatKz(_total)}'),
            ),
          ]);
        },
      ),
    );
  }
}
