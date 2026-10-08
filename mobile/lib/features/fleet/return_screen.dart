import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../app/theme.dart';
import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/format/format.dart';
import '../../core/widgets/photo_field.dart';
import '../../core/widgets/widgets.dart';
import '../payments/common.dart';
import '../shared/providers.dart';
import 'handover.dart';

/// Devolver a viatura: regista o estado, cobra a última semana (por dias, sem o dia da devolução)
/// e faz o acerto: dívida, caução a usar e caução a devolver.
class ReturnScreen extends ConsumerStatefulWidget {
  const ReturnScreen({super.key, required this.assignment});

  final Map<String, dynamic> assignment;

  @override
  ConsumerState<ReturnScreen> createState() => _ReturnScreenState();
}

class _ReturnScreenState extends ConsumerState<ReturnScreen> {
  DateTime _endAt = DateTime.now();
  final _mileage = TextEditingController();
  final _damages = TextEditingController();
  String _fuel = 'meio';
  String _reason = 'devolucao';
  Map<String, bool> _checklist = {for (final key in handoverItems.keys) key: false};
  List<XFile> _photos = [];
  bool _applyDeposit = true;
  bool _busy = false;

  String get _driverId => widget.assignment['driver_id'] as String;
  int get _deposit => asInt(widget.assignment['deposit_received']);

  @override
  void dispose() {
    _mileage.dispose();
    _damages.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Confirmar devolução?'),
        content: const Text('A atribuição é encerrada e a última semana é cobrada até ao dia de hoje.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Devolver')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      final photoIds = await uploadAll(ref, _photos, 'devolucao-viatura');
      final result = await ref.read(apiProvider).post<Map<String, dynamic>>('/assignments/${widget.assignment['id']}/return', {
        'endAt': _endAt.toUtc().toIso8601String(),
        'reason': _reason,
        'applyDeposit': _applyDeposit && _deposit > 0,
        'returnInfo': {
          'mileage': int.tryParse(_mileage.text),
          'fuelLevel': _fuel,
          'checklist': _checklist,
          'photoFileIds': photoIds,
          'damages': _damages.text.trim().isEmpty ? null : _damages.text.trim(),
        },
      });
      invalidateFleet(ref, vehicleId: widget.assignment['vehicle_id'] as String, driverId: _driverId);
      invalidateMoney(ref, driverId: _driverId);
      if (!mounted) return;
      await _showSettlement(Map<String, dynamic>.from(result['settlement'] as Map));
      if (mounted) context.pop();
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _showSettlement(Map<String, dynamic> settlement) => showDialog<void>(
        context: context,
        builder: (context) {
          Widget line(String label, int value, {Color? color}) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(children: [
                  Expanded(child: Text(label)),
                  Text(formatKz(value), style: TextStyle(fontWeight: FontWeight.w700, color: color)),
                ]),
              );
          final debt = asInt(settlement['remainingDebt']);
          final refund = asInt(settlement['depositToReturn']);
          return AlertDialog(
            title: const Text('Acerto da devolução'),
            content: Column(mainAxisSize: MainAxisSize.min, children: [
              line('Caução recebida', asInt(settlement['deposit'])),
              line('Caução usada para a dívida', asInt(settlement['depositApplied'])),
              const Divider(),
              line('Caução a devolver', refund, color: refund > 0 ? Brand.ok : null),
              line('Dívida que fica', debt, color: debt > 0 ? Brand.danger : null),
              if (asInt(settlement['credit']) > 0) line('Crédito do motorista', asInt(settlement['credit']), color: Brand.ok),
            ]),
            actions: [FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Concluir'))],
          );
        },
      );

  @override
  Widget build(BuildContext context) {
    final statement = ref.watch(driverStatementProvider(_driverId)).value?.data;
    final balance = statement?.balance ?? 0;
    final useDeposit = _applyDeposit && _deposit > 0 && balance > 0;
    final applied = useDeposit ? (balance < _deposit ? balance : _deposit) : 0;
    return Scaffold(
      appBar: AppBar(title: const Text('Devolver viatura')),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
        Card(
          child: ListTile(
            leading: Avatar('${widget.assignment['driver_name'] ?? ''}'),
            title: Text('${widget.assignment['driver_name'] ?? 'Motorista'}', style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('Desde ${formatDate(DateTime.parse('${widget.assignment['start_at']}'))}'),
          ),
        ),
        const SizedBox(height: 12),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'devolucao', label: Text('Devolução')),
            ButtonSegment(value: 'substituida', label: Text('Troca')),
            ButtonSegment(value: 'rescindida', label: Text('Rescisão')),
          ],
          selected: {_reason},
          onSelectionChanged: (value) => setState(() => _reason = value.first),
        ),
        DateTimeField(label: 'Data da devolução', value: _endAt, lastDate: DateTime.now(), onChanged: (value) => setState(() => _endAt = value)),
        TextField(
          controller: _mileage,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: const InputDecoration(labelText: 'Quilometragem', suffixText: 'km'),
        ),
        const SizedBox(height: 12),
        Text('Combustível', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 8),
        FuelPicker(value: _fuel, onChanged: (value) => setState(() => _fuel = value)),
        const SizedBox(height: 16),
        Text('Devolvida com', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 8),
        ChecklistField(values: _checklist, onChanged: (value) => setState(() => _checklist = value)),
        const SizedBox(height: 16),
        MultiPhotoField(label: 'Fotos do estado', photos: _photos, onChanged: (value) => setState(() => _photos = value)),
        const SizedBox(height: 12),
        TextField(controller: _damages, maxLines: 3, decoration: const InputDecoration(labelText: 'Danos encontrados')),
        const SectionHeader('Acerto'),
        Card(
          child: Column(children: [
            ListTile(title: const Text('Saldo atual do motorista'), trailing: Text(formatKz(balance), style: const TextStyle(fontWeight: FontWeight.w700))),
            ListTile(title: const Text('Caução recebida'), trailing: Text(formatKz(_deposit))),
            if (_deposit > 0)
              SwitchListTile(
                title: const Text('Usar a caução para pagar a dívida'),
                subtitle: Text(useDeposit ? 'Usa ${formatKz(applied)}; devolve ${formatKz(_deposit - applied)}.' : 'A caução é devolvida por inteiro.'),
                value: _applyDeposit,
                onChanged: (value) => setState(() => _applyDeposit = value),
              ),
            const ListTile(
              dense: true,
              leading: Icon(Icons.info_outline),
              title: Text('A última semana é cobrada ao gravar (dias até à data da devolução); o acerto final aparece a seguir.'),
            ),
          ]),
        ),
        const SizedBox(height: 24),
        FilledButton(key: const Key('confirm_return'), onPressed: _busy ? null : _submit, child: Text(_busy ? 'A guardar…' : 'Devolver viatura')),
      ]),
    );
  }
}
