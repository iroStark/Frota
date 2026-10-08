import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/widgets/photo_field.dart';
import '../../core/widgets/widgets.dart';
import '../payments/common.dart';
import '../shared/providers.dart';

const contactRelations = ['esposa', 'marido', 'pai', 'mãe', 'irmão', 'irmã', 'filho(a)', 'amigo(a)', 'outro'];

class _Contact {
  _Contact([Map<String, dynamic>? data])
      : name = TextEditingController(text: data?['name'] as String? ?? ''),
        phone = TextEditingController(text: (data?['phone'] as String? ?? '').replaceFirst('+244', '')),
        relation = data?['relation'] as String? ?? 'esposa';

  final TextEditingController name;
  final TextEditingController phone;
  String relation;

  bool get isEmpty => name.text.trim().isEmpty && phone.text.trim().isEmpty;
}

/// Registar ou editar um motorista, em 3 passos curtos (no telemóvel um formulário de 20 campos
/// numa só página é difícil de preencher).
class DriverFormScreen extends ConsumerStatefulWidget {
  const DriverFormScreen({super.key, this.driver});

  final Map<String, dynamic>? driver;

  @override
  ConsumerState<DriverFormScreen> createState() => _DriverFormScreenState();
}

class _DriverFormScreenState extends ConsumerState<DriverFormScreen> {
  final _forms = [GlobalKey<FormState>(), GlobalKey<FormState>(), GlobalKey<FormState>()];
  late final Map<String, dynamic> _d = widget.driver ?? const {};
  late final _name = TextEditingController(text: _d['name'] as String? ?? '');
  late final _phone = TextEditingController(text: (_d['phone'] as String? ?? '').replaceFirst('+244', ''));
  late final _bi = TextEditingController(text: _d['bi'] as String? ?? '');
  late final _nif = TextEditingController(text: _d['nif'] as String? ?? '');
  late final _license = TextEditingController(text: _d['license_number'] as String? ?? '');
  late final _category = TextEditingController(text: _d['license_category'] as String? ?? '');
  late final _address = TextEditingController(text: _d['address'] as String? ?? '');
  late final _deposit = TextEditingController(text: _d['deposit'] == null ? '' : groupKz((_d['deposit'] as num).toInt()));
  late final List<_Contact> _contacts = [
    for (final contact in (_d['contacts'] as List? ?? const []).cast<Map>()) _Contact(Map<String, dynamic>.from(contact)),
  ];
  XFile? _photo;
  int _step = 0;
  bool _busy = false;

  bool get _editing => widget.driver != null;

  @override
  void initState() {
    super.initState();
    while (_contacts.length < 2) {
      _contacts.add(_Contact());
    }
  }

  @override
  void dispose() {
    for (final controller in [_name, _phone, _bi, _nif, _license, _category, _address, _deposit]) {
      controller.dispose();
    }
    for (final contact in _contacts) {
      contact.name.dispose();
      contact.phone.dispose();
    }
    super.dispose();
  }

  String? _phoneValidator(String? value, {bool required = false}) {
    final digits = (value ?? '').replaceAll(RegExp(r'\D'), '');
    if (digits.isEmpty) return required ? 'Obrigatório.' : null;
    return digits.length == 9 && digits.startsWith('9') ? null : 'Telefone angolano com 9 dígitos (9XX XXX XXX).';
  }

  Future<void> _submit() async {
    for (final form in _forms) {
      if (form.currentState != null && !form.currentState!.validate()) return;
    }
    setState(() => _busy = true);
    final api = ref.read(apiProvider);
    try {
      final photoId = _photo == null ? null : await api.uploadFile(_photo!.path, category: 'motorista-foto');
      String? text(TextEditingController controller) => controller.text.trim().isEmpty ? null : controller.text.trim();
      final body = {
        'name': _name.text.trim(),
        'phone': text(_phone),
        'bi': text(_bi),
        'nif': text(_nif),
        'licenseNumber': text(_license),
        'licenseCategory': text(_category),
        'address': text(_address),
        'deposit': parseKz(_deposit.text),
        'photoFileId': ?photoId,
        'contacts': [
          for (final contact in _contacts.where((contact) => !contact.isEmpty))
            {'name': contact.name.text.trim(), 'relation': contact.relation, 'phone': text(contact.phone)},
        ],
      };
      final saved = _editing
          ? await api.patch<Map<String, dynamic>>('/drivers/${widget.driver!['id']}', body)
          : await api.post<Map<String, dynamic>>('/drivers', body);
      invalidateFleet(ref, driverId: saved['id'] as String);
      if (!mounted) return;
      showMessage(context, _editing ? 'Motorista atualizado.' : 'Motorista registado.');
      if (_editing) {
        context.pop();
      } else {
        context.pushReplacement('/motoristas/${saved['id']}');
      }
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _next() {
    if (!_forms[_step].currentState!.validate()) return;
    if (_step < 2) {
      setState(() => _step++);
    } else {
      _submit();
    }
  }

  @override
  Widget build(BuildContext context) {
    final digits = [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(9)];
    return Scaffold(
      appBar: AppBar(title: Text(_editing ? 'Editar motorista' : 'Novo motorista')),
      body: Stepper(
        currentStep: _step,
        onStepTapped: (step) => setState(() => _step = step),
        onStepContinue: _busy ? null : _next,
        onStepCancel: _step == 0 ? null : () => setState(() => _step--),
        // O Stepper cria controlos para cada passo: identificar pelo índice do passo e só mostrar no ativo.
        controlsBuilder: (context, details) => details.stepIndex != _step ? const SizedBox.shrink() : Padding(
          padding: const EdgeInsets.only(top: 16),
          child: Row(children: [
            Expanded(
              child: FilledButton(
                key: Key('step_next_${details.stepIndex}'),
                onPressed: details.onStepContinue,
                child: Text(details.stepIndex < 2 ? 'Continuar' : (_busy ? 'A guardar…' : 'Guardar motorista')),
              ),
            ),
            if (details.stepIndex > 0) ...[
              const SizedBox(width: 12),
              TextButton(onPressed: details.onStepCancel, child: const Text('Voltar')),
            ],
          ]),
        ),
        steps: [
          Step(
            title: const Text('Identificação'),
            isActive: _step >= 0,
            content: Form(
              key: _forms[0],
              child: Column(children: [
                PhotoField(label: 'Foto do motorista', value: _photo, onChanged: (file) => setState(() => _photo = file)),
                const SizedBox(height: 12),
                TextFormField(
                  key: const Key('driver_name'),
                  controller: _name,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(labelText: 'Nome completo'),
                  validator: (value) => (value ?? '').trim().split(RegExp(r'\s+')).length < 2 ? 'Nome e apelido.' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  key: const Key('driver_phone'),
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  inputFormatters: digits,
                  decoration: const InputDecoration(labelText: 'Telefone', prefixText: '+244 ', helperText: 'Usado para entrar na app.'),
                  validator: (value) => _phoneValidator(value, required: true),
                ),
                const SizedBox(height: 12),
                TextFormField(controller: _bi, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'N.º do BI')),
                const SizedBox(height: 12),
                TextFormField(controller: _nif, decoration: const InputDecoration(labelText: 'NIF')),
              ]),
            ),
          ),
          Step(
            title: const Text('Carta e morada'),
            isActive: _step >= 1,
            content: Form(
              key: _forms[1],
              child: Column(children: [
                TextFormField(controller: _license, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'N.º da carta de condução')),
                const SizedBox(height: 12),
                TextFormField(controller: _category, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Categoria', hintText: 'B, C…')),
                const SizedBox(height: 12),
                TextFormField(controller: _address, maxLines: 2, decoration: const InputDecoration(labelText: 'Morada')),
                const SizedBox(height: 8),
                Text('A validade do BI e da carta regista-se nos documentos do motorista (com foto).', style: Theme.of(context).textTheme.bodySmall),
              ]),
            ),
          ),
          Step(
            title: const Text('Contactos e caução'),
            isActive: _step >= 2,
            content: Form(
              key: _forms[2],
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                for (final (index, contact) in _contacts.indexed) ...[
                  Text('Contacto de emergência ${index + 1}', style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: 8),
                  TextFormField(controller: contact.name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Nome')),
                  const SizedBox(height: 8),
                  Row(children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: contact.relation,
                        decoration: const InputDecoration(labelText: 'Relação'),
                        items: [for (final relation in contactRelations) DropdownMenuItem(value: relation, child: Text(relation))],
                        onChanged: (value) => setState(() => contact.relation = value ?? contact.relation),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextFormField(
                        controller: contact.phone,
                        keyboardType: TextInputType.phone,
                        inputFormatters: digits,
                        decoration: const InputDecoration(labelText: 'Telefone'),
                        validator: _phoneValidator,
                      ),
                    ),
                  ]),
                  const SizedBox(height: 16),
                ],
                KzField(controller: _deposit, label: 'Caução entregue', allowZero: true),
              ]),
            ),
          ),
        ],
      ),
    );
  }
}
