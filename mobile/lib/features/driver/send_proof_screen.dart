import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/format/format.dart';
import '../../core/widgets/photo_field.dart';
import '../../core/widgets/widgets.dart';
import '../payments/common.dart';
import '../shared/providers.dart';

/// O motorista envia a foto do comprovativo; o gestor confirma. Para o prazo conta a hora do
/// pagamento se o comprovativo for enviado até 12 horas depois (regra do contrato).
class SendProofScreen extends ConsumerStatefulWidget {
  const SendProofScreen({super.key});

  @override
  ConsumerState<SendProofScreen> createState() => _SendProofScreenState();
}

class _SendProofScreenState extends ConsumerState<SendProofScreen> {
  final _form = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  final _clientId = const Uuid().v4();
  String _method = 'transferencia';
  DateTime _paidAt = DateTime.now();
  XFile? _photo;
  bool _busy = false;
  bool _prefilled = false;

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    if (_photo == null) {
      showMessage(context, 'Junte a foto do comprovativo.');
      return;
    }
    setState(() => _busy = true);
    final api = ref.read(apiProvider);
    try {
      final fileId = await api.uploadFile(_photo!.path, category: 'comprovativo-motorista');
      await api.post<Map<String, dynamic>>('/me/payment-declarations', {
        'amount': parseKz(_amount.text),
        'paidAt': _paidAt.toUtc().toIso8601String(),
        'method': _method,
        'reference': _reference.text.trim().isEmpty ? null : _reference.text.trim(),
        'proofFileId': fileId,
        'clientId': _clientId,
      });
      ref.invalidate(driverHomeProvider);
      if (!mounted) return;
      showMessage(context, 'Comprovativo enviado. Vai receber a confirmação da gestão.');
      context.pop();
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final home = ref.watch(driverHomeProvider).value?.data;
    if (!_prefilled && home != null) {
      _prefilled = true;
      final suggested = home.overdue > 0 ? home.overdue : home.balance > 0 ? home.balance : home.nextDue?.estimatedAmount ?? 0;
      if (suggested > 0) _amount.text = groupKz(suggested);
    }
    final hoursSincePayment = DateTime.now().difference(_paidAt).inHours;
    return Scaffold(
      appBar: AppBar(title: const Text('Enviar comprovativo')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
          if (home != null && home.overdue > 0)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text('Tem ${formatKz(home.overdue)} em atraso.', style: Theme.of(context).textTheme.titleSmall),
            ),
          PhotoField(label: 'Foto do comprovativo', value: _photo, required: true, onChanged: (file) => setState(() => _photo = file)),
          const SizedBox(height: 16),
          KzField(controller: _amount, label: 'Valor pago'),
          const SectionHeader('Como pagou'),
          MethodPicker(value: _method, onChanged: (value) => setState(() => _method = value)),
          DateTimeField(label: 'Pago em', value: _paidAt, lastDate: DateTime.now(), onChanged: (value) => setState(() => _paidAt = value)),
          if (hoursSincePayment > 12)
            Text(
              'Enviado mais de 12 h depois do pagamento: para o prazo conta a hora de envio.',
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          TextFormField(controller: _reference, decoration: const InputDecoration(labelText: 'Referência (opcional)')),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: _busy ? null : _submit,
            icon: const Icon(Icons.send),
            label: Text(_busy ? 'A enviar…' : 'Enviar para confirmação'),
          ),
        ]),
      ),
    );
  }
}
