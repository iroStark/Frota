import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/format/format.dart';
import '../../core/widgets/photo_field.dart';
import '../../core/widgets/widgets.dart';
import '../payments/common.dart';
import '../shared/providers.dart';
import 'handover.dart';

/// Atribuir viatura em 3 passos: quem e o quê → condições → checklist de entrega com fotos.
/// Só aparecem viaturas disponíveis e motoristas sem viatura (o servidor também o garante).
class AssignScreen extends ConsumerStatefulWidget {
  const AssignScreen({super.key, this.vehicleId, this.driverId});

  final String? vehicleId;
  final String? driverId;

  @override
  ConsumerState<AssignScreen> createState() => _AssignScreenState();
}

class _AssignScreenState extends ConsumerState<AssignScreen> {
  late String? _vehicleId = widget.vehicleId;
  late String? _driverId = widget.driverId;
  int _step = 0;
  DateTime _startAt = DateTime.now();
  final _fee = TextEditingController();
  final _deposit = TextEditingController();
  final _mileage = TextEditingController();
  final _notes = TextEditingController();
  String _fuel = 'meio';
  Map<String, bool> _checklist = {for (final key in handoverItems.keys) key: false};
  List<XFile> _photos = [];
  bool _busy = false;

  @override
  void dispose() {
    for (final controller in [_fee, _deposit, _mileage, _notes]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      final photoIds = await uploadAll(ref, _photos, 'entrega-viatura');
      final created = await ref.read(apiProvider).post<Map<String, dynamic>>('/assignments', {
        'vehicleId': _vehicleId,
        'driverId': _driverId,
        'startAt': _startAt.toUtc().toIso8601String(),
        'weeklyFee': parseKz(_fee.text),
        'depositReceived': parseKz(_deposit.text),
        'handover': {
          'mileage': int.tryParse(_mileage.text),
          'fuelLevel': _fuel,
          'checklist': _checklist,
          'photoFileIds': photoIds,
        },
        'notes': _notes.text.trim().isEmpty ? null : _notes.text.trim(),
      });
      invalidateFleet(ref, vehicleId: _vehicleId, driverId: _driverId);
      if (!mounted) return;
      showMessage(context, 'Viatura atribuída.');
      context.pushReplacement('/viaturas/${created['vehicle_id']}');
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final vehicles = ref.watch(vehiclesProvider).value?.data ?? const [];
    final drivers = ref.watch(driversProvider).value?.data ?? const [];
    final rules = ref.watch(contractRulesProvider).value?.data;
    if (_fee.text.isEmpty && rules != null) _fee.text = groupKz(asInt(rules['weeklyFee']));
    // A caução fica no registo do motorista: sugerir esse valor na atribuição.
    if (_driverId != null && _deposit.text.isEmpty) {
      final deposit = asInt(ref.watch(driverDetailProvider(_driverId!)).value?.data['deposit']);
      if (deposit > 0) _deposit.text = groupKz(deposit);
    }
    // Os itens escolhidos ficam sempre na lista: depois de gravar, as listas atualizam e a viatura e o
    // motorista deixam de estar livres (o DropdownButton exige que o valor exista nos itens).
    final availableVehicles = vehicles.where((v) => v['status'] == 'disponivel' || v['id'] == _vehicleId).toList();
    final freeDrivers = drivers.where((d) => d['assignment_id'] == null || d['id'] == _driverId).toList();
    final canContinue = switch (_step) {
      0 => _vehicleId != null && _driverId != null,
      1 => parseKz(_fee.text) > 0,
      _ => true,
    };

    return Scaffold(
      appBar: AppBar(title: const Text('Atribuir viatura')),
      body: Stepper(
        currentStep: _step,
        onStepTapped: (step) => setState(() => _step = step <= _step ? step : _step),
        onStepContinue: !canContinue || _busy ? null : () => _step < 2 ? setState(() => _step++) : _submit(),
        onStepCancel: _step == 0 ? null : () => setState(() => _step--),
        controlsBuilder: (context, details) => details.stepIndex != _step ? const SizedBox.shrink() : Padding(
          padding: const EdgeInsets.only(top: 16),
          child: Row(children: [
            Expanded(
              child: FilledButton(
                key: Key('assign_next_${details.stepIndex}'),
                onPressed: details.onStepContinue,
                child: Text(details.stepIndex < 2 ? 'Continuar' : (_busy ? 'A guardar…' : 'Entregar viatura')),
              ),
            ),
            if (details.stepIndex > 0) ...[const SizedBox(width: 12), TextButton(onPressed: details.onStepCancel, child: const Text('Voltar'))],
          ]),
        ),
        steps: [
          Step(
            title: const Text('Viatura e motorista'),
            isActive: true,
            content: Column(children: [
              DropdownButtonFormField<String>(
                key: const Key('assign_vehicle'),
                initialValue: _vehicleId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Viatura disponível'),
                items: [
                  for (final v in availableVehicles)
                    DropdownMenuItem(value: v['id'] as String, child: Text('${v['brand']} ${v['model']} · ${v['plate'] ?? 'sem matrícula'}')),
                ],
                onChanged: (value) => setState(() => _vehicleId = value),
              ),
              if (availableVehicles.isEmpty) const EmptyState('Nenhuma viatura disponível.'),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                key: const Key('assign_driver'),
                initialValue: _driverId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Motorista sem viatura'),
                items: [for (final d in freeDrivers) DropdownMenuItem(value: d['id'] as String, child: Text('${d['name']}'))],
                onChanged: (value) => setState(() => _driverId = value),
              ),
              if (freeDrivers.isEmpty) const EmptyState('Todos os motoristas já têm viatura.'),
            ]),
          ),
          Step(
            title: const Text('Condições'),
            isActive: _step >= 1,
            content: Column(children: [
              DateTimeField(label: 'Data da entrega', value: _startAt, onChanged: (value) => setState(() => _startAt = value)),
              KzField(controller: _fee, label: 'Entrega semanal acordada', onChanged: (_) => setState(() {})),
              const SizedBox(height: 4),
              Text(
                'Cobrada por dias: ${formatKz((parseKz(_fee.text) / 6).round())} por dia (terça a domingo). A 1.ª semana conta a partir do dia da entrega.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 12),
              KzField(controller: _deposit, label: 'Caução recebida', allowZero: true),
            ]),
          ),
          Step(
            title: const Text('Checklist de entrega'),
            isActive: _step >= 2,
            content: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
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
              Text('Entregue com', style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              ChecklistField(values: _checklist, onChanged: (value) => setState(() => _checklist = value)),
              const SizedBox(height: 16),
              MultiPhotoField(label: 'Fotos (frente, traseira, lados, interior)', photos: _photos, onChanged: (value) => setState(() => _photos = value)),
              const SizedBox(height: 12),
              TextField(controller: _notes, maxLines: 3, decoration: const InputDecoration(labelText: 'Notas (riscos, danos já existentes…)')),
            ]),
          ),
        ],
      ),
    );
  }
}
