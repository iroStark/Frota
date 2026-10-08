import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/format/format.dart';
import '../../core/widgets/photo_field.dart';
import '../../core/widgets/widgets.dart';
import '../payments/common.dart';
import '../shared/providers.dart';

const expenseCategories = {
  'combustivel': 'Combustível',
  'lavagem': 'Lavagem',
  'manutencao': 'Manutenção',
  'pneu': 'Pneus / alinhamento',
  'seguro': 'Seguro',
  'multa': 'Multa / coima',
  'documentacao': 'Documentação',
  'operacional': 'Operacional',
  'outro': 'Outro',
};

/// Mesma regra do servidor (domain/money.ts → splitTotal): os primeiros ficam com +1 kwanza.
List<int> splitTotal(int total, int parts) {
  if (parts <= 0) return const [];
  final base = total ~/ parts;
  final remainder = total - base * parts;
  return [for (var i = 0; i < parts; i++) base + (i < remainder ? 1 : 0)];
}

class ExpensesScreen extends ConsumerWidget {
  const ExpensesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        appBar: AppBar(title: const Text('Despesas')),
        floatingActionButton: FloatingActionButton.extended(
          key: const Key('new_expense'),
          onPressed: () => context.push('/despesas/nova'),
          icon: const Icon(Icons.add),
          label: const Text('Nova'),
        ),
        body: CachedBody<List<Map<String, dynamic>>>(
          provider: expensesProvider,
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
          builder: (context, rows) {
            if (rows.isEmpty) return [const EmptyState('Sem despesas registadas.')];
            final byMonth = <String, List<Map<String, dynamic>>>{};
            for (final row in rows) {
              byMonth.putIfAbsent('${row['spent_on']}'.substring(0, 7), () => []).add(row);
            }
            return [
              for (final entry in byMonth.entries) ...[
                SectionHeader(
                  toBeginningOfSentenceCase(DateFormat('MMMM y', 'pt_PT').format(DateTime.parse('${entry.key}-01'))),
                  trailing: Text(formatKz(entry.value.where((r) => r['responsible'] == 'proprietaria').fold<int>(0, (sum, r) => sum + asInt(r['amount'])))),
                ),
                for (final row in entry.value)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      title: Text(expenseCategories[row['category']] ?? '${row['category']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text([
                        row['plate'] ?? 'Geral',
                        formatDay('${row['spent_on']}'),
                        if (row['supplier'] != null) '${row['supplier']}',
                        if (row['batch_total'] != null) 'lote de ${row['batch_vehicle_count']} viaturas: ${formatKz(asInt(row['batch_total']))}',
                      ].join(' · ')),
                      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Text(formatKz(asInt(row['amount'])), style: const TextStyle(fontWeight: FontWeight.w700)),
                        Text(row['responsible'] == 'motorista' ? 'Motorista' : 'Proprietária', style: Theme.of(context).textTheme.bodySmall),
                      ]),
                    ),
                  ),
              ],
            ];
          },
        ),
      );
}

class ExpenseFormScreen extends ConsumerStatefulWidget {
  const ExpenseFormScreen({super.key});

  @override
  ConsumerState<ExpenseFormScreen> createState() => _ExpenseFormScreenState();
}

class _ExpenseFormScreenState extends ConsumerState<ExpenseFormScreen> {
  String _mode = 'unica';
  final Set<String> _vehicles = {};
  final _amount = TextEditingController();
  final _supplier = TextEditingController();
  final _notes = TextEditingController();
  final _clientId = const Uuid().v4();
  String _category = 'manutencao';
  String _responsible = 'proprietaria';
  DateTime _spentOn = DateTime.now();
  XFile? _receipt;
  bool _busy = false;

  @override
  void dispose() {
    _amount.dispose();
    _supplier.dispose();
    _notes.dispose();
    super.dispose();
  }

  List<int> get _amounts {
    final amount = parseKz(_amount.text);
    return switch (_mode) {
      'dividir_total' => splitTotal(amount, _vehicles.length),
      'por_viatura' => [for (final _ in _vehicles) amount],
      _ => [amount],
    };
  }

  Future<void> _submit() async {
    final amount = parseKz(_amount.text);
    if (amount <= 0) {
      showMessage(context, 'Indique o valor.');
      return;
    }
    if (_mode != 'unica' && _vehicles.isEmpty) {
      showMessage(context, 'Escolha as viaturas.');
      return;
    }
    setState(() => _busy = true);
    final api = ref.read(apiProvider);
    try {
      final receiptId = _receipt == null ? null : await api.uploadFile(_receipt!.path, category: 'despesa-recibo');
      await api.post<Map<String, dynamic>>('/expenses', {
        'mode': _mode,
        'vehicleIds': _vehicles.toList(),
        'amount': amount,
        'category': _category,
        'responsible': _responsible,
        'spentOn': isoDay(_spentOn),
        'supplier': _supplier.text.trim().isEmpty ? null : _supplier.text.trim(),
        'receiptFileId': receiptId,
        'notes': _notes.text.trim().isEmpty ? null : _notes.text.trim(),
        'clientId': _clientId,
      });
      ref.invalidate(expensesProvider);
      ref.invalidate(dashboardProvider);
      for (final id in _vehicles) {
        ref.invalidate(vehicleDetailProvider(id));
      }
      if (!mounted) return;
      final total = _amounts.fold<int>(0, (sum, value) => sum + value);
      showMessage(context, 'Despesa registada: ${formatKz(total)}.');
      context.pop();
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final vehicles = (ref.watch(vehiclesProvider).value?.data ?? const []).where((v) => v['status'] != 'abatida').toList();
    final amounts = _amounts;
    final total = amounts.fold<int>(0, (sum, value) => sum + value);
    return Scaffold(
      appBar: AppBar(title: const Text('Nova despesa')),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'unica', label: Text('Uma viatura')),
            ButtonSegment(value: 'por_viatura', label: Text('Por viatura')),
            ButtonSegment(value: 'dividir_total', label: Text('Dividir total')),
          ],
          selected: {_mode},
          onSelectionChanged: (value) => setState(() {
            _mode = value.first;
            if (_mode == 'unica' && _vehicles.length > 1) {
              final first = _vehicles.first;
              _vehicles
                ..clear()
                ..add(first);
            }
          }),
        ),
        const SizedBox(height: 12),
        Text(
          switch (_mode) {
            'por_viatura' => 'O valor indicado é o de cada viatura; o total é valor × número de viaturas.',
            'dividir_total' => 'O valor indicado é o total da fatura, dividido pelas viaturas escolhidas.',
            _ => 'Uma viatura, ou nenhuma para uma despesa geral.',
          },
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SectionHeader('Viaturas'),
        if (_mode != 'unica')
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () => setState(() => _vehicles
                ..clear()
                ..addAll(vehicles.where((v) => v['status'] != 'imobilizada').map((v) => v['id'] as String))),
              child: const Text('Todas as viaturas ativas'),
            ),
          ),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final v in vehicles)
            FilterChip(
              label: Text('${v['plate'] ?? '${v['brand']} ${v['model']}'}'),
              selected: _vehicles.contains(v['id']),
              onSelected: (selected) => setState(() {
                final id = v['id'] as String;
                if (_mode == 'unica') _vehicles.clear();
                if (selected) {
                  _vehicles.add(id);
                } else {
                  _vehicles.remove(id);
                }
              }),
            ),
        ]),
        const SizedBox(height: 16),
        KzField(
          fieldKey: const Key('expense_amount'),
          controller: _amount,
          label: switch (_mode) { 'por_viatura' => 'Valor por viatura', 'dividir_total' => 'Valor total', _ => 'Valor' },
          onChanged: (_) => setState(() {}),
        ),
        if (_mode != 'unica' && _vehicles.isNotEmpty && parseKz(_amount.text) > 0)
          Card(
            margin: const EdgeInsets.only(top: 12),
            child: ListTile(
              leading: const Icon(Icons.calculate_outlined),
              title: Text('${_vehicles.length} viaturas · total ${formatKz(total)}', key: const Key('expense_total')),
              subtitle: Text(_mode == 'dividir_total'
                  ? 'Cada viatura: ${amounts.toSet().map(formatKz).join(' ou ')}'
                  : '${_vehicles.length} × ${formatKz(parseKz(_amount.text))}'),
            ),
          ),
        const SectionHeader('Detalhes'),
        DropdownButtonFormField<String>(
          initialValue: _category,
          decoration: const InputDecoration(labelText: 'Categoria'),
          items: [for (final entry in expenseCategories.entries) DropdownMenuItem(value: entry.key, child: Text(entry.value))],
          onChanged: (value) => setState(() => _category = value ?? _category),
        ),
        const SizedBox(height: 12),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'proprietaria', label: Text('Paga a proprietária')),
            ButtonSegment(value: 'motorista', label: Text('Paga o motorista')),
          ],
          selected: {_responsible},
          onSelectionChanged: (value) => setState(() => _responsible = value.first),
        ),
        DateOnlyField(label: 'Data', value: _spentOn, lastDate: DateTime.now(), onChanged: (value) => setState(() => _spentOn = value ?? _spentOn)),
        TextField(controller: _supplier, decoration: const InputDecoration(labelText: 'Fornecedor (oficina, seguradora…)')),
        const SizedBox(height: 12),
        PhotoField(label: 'Foto do recibo', value: _receipt, onChanged: (file) => setState(() => _receipt = file)),
        const SizedBox(height: 12),
        TextField(controller: _notes, maxLines: 2, decoration: const InputDecoration(labelText: 'Notas')),
        const SizedBox(height: 24),
        FilledButton(
          key: const Key('save_expense'),
          onPressed: _busy ? null : _submit,
          child: Text(_busy ? 'A guardar…' : total > 0 ? 'Registar ${formatKz(total)}' : 'Registar despesa'),
        ),
      ]),
    );
  }
}
