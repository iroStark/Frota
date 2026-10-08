import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/widgets/photo_field.dart';
import '../../core/widgets/widgets.dart';
import '../payments/common.dart';
import '../payments/review_screen.dart' show incidentTypeLabels;
import '../shared/providers.dart';

/// Tipos que contam como dias parados (o servidor aplica a mesma regra por omissão).
const exemptingTypes = {'doenca', 'licenca', 'manutencao', 'paragem_tecnica', 'sinistro', 'avaria'};

/// Comunicar (motorista) ou registar (gestor) uma ocorrência. O que o motorista envia fica
/// "por validar" e só desconta dias depois de o gestor validar.
class IncidentFormScreen extends ConsumerStatefulWidget {
  const IncidentFormScreen({super.key, this.vehicleId});

  final String? vehicleId;

  @override
  ConsumerState<IncidentFormScreen> createState() => _IncidentFormScreenState();
}

class _IncidentFormScreenState extends ConsumerState<IncidentFormScreen> {
  String _type = 'avaria';
  late String? _vehicleId = widget.vehicleId;
  DateTime _startAt = DateTime.now();
  DateTime? _endAt;
  final _notes = TextEditingController();
  final _amount = TextEditingController();
  bool? _exempts;
  bool _immobilizes = false;
  List<XFile> _photos = [];
  Position? _position;
  bool _locating = false;
  bool _busy = false;

  bool get _isDriver => ref.read(sessionProvider).user?.isStaff == false;
  bool get _exemptsValue => _exempts ?? exemptingTypes.contains(_type);

  @override
  void dispose() {
    _notes.dispose();
    _amount.dispose();
    super.dispose();
  }

  Future<void> _locate() async {
    setState(() => _locating = true);
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        if (mounted) showMessage(context, 'Sem autorização para usar a localização.');
        return;
      }
      final position = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(timeLimit: Duration(seconds: 15)));
      if (mounted) setState(() => _position = position);
    } catch (_) {
      if (mounted) showMessage(context, 'Não foi possível obter a localização.');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  Future<void> _submit() async {
    if (!_isDriver && _vehicleId == null) {
      showMessage(context, 'Escolha a viatura.');
      return;
    }
    if (_endAt != null && _endAt!.isBefore(_startAt)) {
      showMessage(context, 'O fim não pode ser antes do início.');
      return;
    }
    setState(() => _busy = true);
    try {
      final attachmentIds = await uploadAll(ref, _photos, 'ocorrencia');
      final amount = parseKz(_amount.text);
      await ref.read(apiProvider).post<Map<String, dynamic>>('/incidents', {
        'type': _type,
        'vehicleId': ?(_isDriver ? null : _vehicleId),
        'startAt': _startAt.toUtc().toIso8601String(),
        'endAt': _endAt?.toUtc().toIso8601String(),
        'notes': _notes.text.trim().isEmpty ? null : _notes.text.trim(),
        'attachmentIds': attachmentIds,
        'latitude': _position?.latitude,
        'longitude': _position?.longitude,
        if (!_isDriver) ...{
          'exemptsFee': _exemptsValue,
          'immobilizes': _immobilizes,
          if (amount > 0) 'amount': amount,
        },
      });
      invalidateIncidents(ref);
      if (!mounted) return;
      showMessage(context, _isDriver ? 'Ocorrência enviada à gestão.' : 'Ocorrência registada; cobranças atualizadas.');
      context.pop();
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDriver = _isDriver;
    final vehicles = isDriver ? const <Map<String, dynamic>>[] : ref.watch(vehiclesProvider).value?.data ?? const [];
    return Scaffold(
      appBar: AppBar(title: Text(isDriver ? 'Comunicar ocorrência' : 'Nova ocorrência')),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
        if (isDriver)
          const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Text('Em caso de acidente comunique em até 2 horas; furto ou roubo em até 4 horas (contrato).'),
          ),
        Text('O que aconteceu', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final entry in incidentTypeLabels.entries)
            ChoiceChip(
              key: Key('incident_type_${entry.key}'),
              label: Text(entry.value),
              selected: _type == entry.key,
              onSelected: (_) => setState(() {
                _type = entry.key;
                _exempts = null;
              }),
            ),
        ]),
        if (!isDriver) ...[
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            key: const Key('incident_vehicle'),
            initialValue: _vehicleId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Viatura'),
            items: [
              for (final v in vehicles)
                DropdownMenuItem(value: v['id'] as String, child: Text('${v['plate'] ?? 'Sem matrícula'} · ${v['driver_name'] ?? 'sem motorista'}')),
            ],
            onChanged: (value) => setState(() => _vehicleId = value),
          ),
        ],
        const SizedBox(height: 8),
        DateTimeField(label: 'Início', value: _startAt, onChanged: (value) => setState(() => _startAt = value)),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.event_available_outlined),
          title: const Text('Fim'),
          subtitle: Text(_endAt == null ? 'Ainda a decorrer' : MaterialLocalizations.of(context).formatFullDate(_endAt!)),
          trailing: _endAt == null
              ? TextButton(
                  onPressed: () => setState(() => _endAt = _startAt.add(const Duration(days: 1))),
                  child: const Text('Definir'),
                )
              : IconButton(tooltip: 'Sem fim', onPressed: () => setState(() => _endAt = null), icon: const Icon(Icons.clear)),
        ),
        if (_endAt != null) DateTimeField(label: 'Data do fim', value: _endAt!, onChanged: (value) => setState(() => _endAt = value)),
        TextField(
          key: const Key('incident_notes'),
          controller: _notes,
          maxLines: 4,
          decoration: const InputDecoration(labelText: 'Descrição', hintText: 'O que aconteceu, onde, quem estava envolvido…'),
        ),
        const SizedBox(height: 16),
        MultiPhotoField(label: 'Fotos', photos: _photos, onChanged: (value) => setState(() => _photos = value)),
        const SizedBox(height: 8),
        if (isDriver)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(_position == null ? Icons.location_off_outlined : Icons.location_on, color: _position == null ? null : Colors.green),
            title: Text(_position == null ? 'Juntar a minha localização' : 'Localização registada'),
            subtitle: _position == null ? null : Text('${_position!.latitude.toStringAsFixed(5)}, ${_position!.longitude.toStringAsFixed(5)}'),
            trailing: _locating ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : null,
            onTap: _locating ? null : _locate,
          ),
        if (!isDriver) ...[
          const SectionHeader('Impacto'),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Descontar dias parados'),
            subtitle: const Text('Dias com 4 h ou mais de paragem não são cobrados.'),
            value: _exemptsValue,
            onChanged: (value) => setState(() => _exempts = value),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Imobilizar a viatura'),
            value: _immobilizes,
            onChanged: (value) => setState(() => _immobilizes = value),
          ),
          if (const {'multa', 'fora_horario', 'sinistro', 'gps'}.contains(_type))
            KzField(
              controller: _amount,
              label: _type == 'sinistro' ? 'Franquia (limitada ao máximo do contrato)' : 'Valor da multa (vazio = valor do contrato)',
              allowZero: true,
            ),
        ],
        const SizedBox(height: 24),
        FilledButton.icon(
          key: const Key('save_incident'),
          onPressed: _busy ? null : _submit,
          icon: Icon(isDriver ? Icons.send : Icons.check),
          label: Text(_busy ? 'A enviar…' : isDriver ? 'Enviar à gestão' : 'Registar ocorrência'),
        ),
      ]),
    );
  }
}
