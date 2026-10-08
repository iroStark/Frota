import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/widgets/photo_field.dart';
import '../../core/widgets/widgets.dart';
import '../shared/providers.dart';

/// Registar ou editar uma viatura. O estado (em serviço, imobilizada…) não se escolhe aqui:
/// é calculado pelo servidor a partir das atribuições e ocorrências.
class VehicleFormScreen extends ConsumerStatefulWidget {
  const VehicleFormScreen({super.key, this.vehicle});

  final Map<String, dynamic>? vehicle;

  @override
  ConsumerState<VehicleFormScreen> createState() => _VehicleFormScreenState();
}

class _VehicleFormScreenState extends ConsumerState<VehicleFormScreen> {
  final _form = GlobalKey<FormState>();
  late final _brand = TextEditingController(text: widget.vehicle?['brand'] as String? ?? '');
  late final _model = TextEditingController(text: widget.vehicle?['model'] as String? ?? '');
  late final _plate = TextEditingController(text: widget.vehicle?['plate'] as String? ?? '');
  late final _color = TextEditingController(text: widget.vehicle?['color'] as String? ?? '');
  late final _year = TextEditingController(text: widget.vehicle?['year']?.toString() ?? '');
  late final _chassis = TextEditingController(text: widget.vehicle?['chassis'] as String? ?? '');
  late final _mileage = TextEditingController(text: widget.vehicle?['mileage']?.toString() ?? '');
  XFile? _photo;
  bool _busy = false;
  Map<String, List<String>> _fieldErrors = const {};

  bool get _editing => widget.vehicle != null;

  @override
  void dispose() {
    for (final controller in [_brand, _model, _plate, _color, _year, _chassis, _mileage]) {
      controller.dispose();
    }
    super.dispose();
  }

  String? _serverError(String field) => _fieldErrors[field]?.first;

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _fieldErrors = const {};
    });
    final api = ref.read(apiProvider);
    try {
      final photoId = _photo == null ? null : await api.uploadFile(_photo!.path, category: 'viatura-foto');
      final body = {
        'brand': _brand.text.trim(),
        'model': _model.text.trim(),
        'plate': _plate.text.trim().isEmpty ? null : _plate.text.trim(),
        'color': _color.text.trim().isEmpty ? null : _color.text.trim(),
        'year': int.tryParse(_year.text),
        'chassis': _chassis.text.trim().isEmpty ? null : _chassis.text.trim(),
        'mileage': int.tryParse(_mileage.text),
        'photoFileId': ?photoId,
      };
      final saved = _editing
          ? await api.patch<Map<String, dynamic>>('/vehicles/${widget.vehicle!['id']}', body)
          : await api.post<Map<String, dynamic>>('/vehicles', body);
      invalidateFleet(ref, vehicleId: saved['id'] as String);
      if (!mounted) return;
      showMessage(context, _editing ? 'Viatura atualizada.' : 'Viatura registada.');
      if (_editing) {
        context.pop();
      } else {
        context.pushReplacement('/viaturas/${saved['id']}');
      }
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _fieldErrors = error.fieldErrors);
      showMessage(context, error.code == 'duplicado' ? 'Já existe uma viatura com esta matrícula.' : error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final digits = [FilteringTextInputFormatter.digitsOnly];
    return Scaffold(
      appBar: AppBar(title: Text(_editing ? 'Editar viatura' : 'Nova viatura')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
          PhotoField(label: 'Foto da viatura', value: _photo, onChanged: (file) => setState(() => _photo = file)),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(
              child: TextFormField(
                key: const Key('brand'),
                controller: _brand,
                textCapitalization: TextCapitalization.words,
                decoration: InputDecoration(labelText: 'Marca', errorText: _serverError('brand')),
                validator: (value) => (value ?? '').trim().isEmpty ? 'Obrigatório.' : null,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextFormField(
                key: const Key('model'),
                controller: _model,
                textCapitalization: TextCapitalization.words,
                decoration: InputDecoration(labelText: 'Modelo', errorText: _serverError('model')),
                validator: (value) => (value ?? '').trim().isEmpty ? 'Obrigatório.' : null,
              ),
            ),
          ]),
          const SizedBox(height: 12),
          TextFormField(
            key: const Key('plate'),
            controller: _plate,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(labelText: 'Matrícula', hintText: 'LD-00-00-AA'),
          ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: TextFormField(controller: _color, decoration: const InputDecoration(labelText: 'Cor'))),
            const SizedBox(width: 12),
            Expanded(
              child: TextFormField(
                controller: _year,
                keyboardType: TextInputType.number,
                inputFormatters: [...digits, LengthLimitingTextInputFormatter(4)],
                decoration: InputDecoration(labelText: 'Ano', errorText: _serverError('year')),
                validator: (value) {
                  final year = int.tryParse(value ?? '');
                  if ((value ?? '').isEmpty) return null;
                  return year == null || year < 1950 || year > DateTime.now().year + 1 ? 'Ano inválido.' : null;
                },
              ),
            ),
          ]),
          const SizedBox(height: 12),
          TextFormField(controller: _chassis, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'N.º do chassis')),
          const SizedBox(height: 12),
          TextFormField(
            controller: _mileage,
            keyboardType: TextInputType.number,
            inputFormatters: digits,
            decoration: const InputDecoration(labelText: 'Quilometragem', suffixText: 'km'),
          ),
          const SizedBox(height: 8),
          Text('Livrete, seguro e inspeção registam-se nos documentos da viatura.', style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 24),
          FilledButton(key: const Key('save_vehicle'), onPressed: _busy ? null : _submit, child: Text(_busy ? 'A guardar…' : 'Guardar viatura')),
        ]),
      ),
    );
  }
}
