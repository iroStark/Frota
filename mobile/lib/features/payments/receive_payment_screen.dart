import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import '../../app/theme.dart';
import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/format/format.dart';
import '../../core/widgets/photo_field.dart';
import '../../core/widgets/widgets.dart';
import '../shared/allocation.dart';
import '../shared/providers.dart';
import 'common.dart';

/// Receber dinheiro de um motorista. Mostra antes de guardar a que semanas o valor vai ser aplicado
/// (as mais antigas primeiro) e se sobra crédito.
class ReceivePaymentScreen extends ConsumerStatefulWidget {
  const ReceivePaymentScreen({super.key, this.driverId});

  final String? driverId;

  @override
  ConsumerState<ReceivePaymentScreen> createState() => _ReceivePaymentScreenState();
}

class _ReceivePaymentScreenState extends ConsumerState<ReceivePaymentScreen> {
  final _form = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  final _clientId = const Uuid().v4(); // repetir o envio (rede instável) não duplica o pagamento
  String? _driverId;
  String _method = 'numerario';
  DateTime _receivedAt = DateTime.now();
  XFile? _photo;
  bool _busy = false;
  bool _amountTouched = false;

  @override
  void initState() {
    super.initState();
    _driverId = widget.driverId;
  }

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_driverId == null || !_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final api = ref.read(apiProvider);
    try {
      final proofFileId = _photo == null ? null : await api.uploadFile(_photo!.path, category: 'entrega-comprovativo');
      final result = await api.post<Map<String, dynamic>>('/payments', {
        'driverId': _driverId,
        'amount': parseKz(_amount.text),
        'receivedAt': _receivedAt.toUtc().toIso8601String(),
        'method': _method,
        'reference': _reference.text.trim().isEmpty ? null : _reference.text.trim(),
        'proofFileId': proofFileId,
        'clientId': _clientId,
      });
      invalidateMoney(ref, driverId: _driverId);
      if (!mounted) return;
      final credit = asInt(result['credit']);
      showMessage(context, credit > 0 ? 'Pagamento registado. Ficou ${formatKz(credit)} de crédito.' : 'Pagamento registado.');
      context.pop();
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Receber pagamento'),
        actions: [
          TextButton.icon(
            onPressed: () => context.pushReplacement('/pagamentos/grupo'),
            icon: const Icon(Icons.groups_outlined),
            label: const Text('Em grupo'),
          ),
        ],
      ),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
          _DriverPicker(
            value: _driverId,
            onChanged: (id) => setState(() {
              _driverId = id;
              _amountTouched = false;
              _amount.clear();
            }),
          ),
          if (_driverId != null) ...[
            const SizedBox(height: 16),
            Consumer(builder: (context, ref, _) {
              final statement = ref.watch(driverStatementProvider(_driverId!));
              return statement.when(
                loading: () => const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
                error: (error, _) => ErrorRetry(error: error, onRetry: () => ref.invalidate(driverStatementProvider(_driverId!))),
                data: (cached) {
                  final open = openCharges(cached.data);
                  final totalOpen = open.fold<int>(0, (sum, charge) => sum + charge.outstanding);
                  if (!_amountTouched && _amount.text.isEmpty && totalOpen > 0) {
                    WidgetsBinding.instance.addPostFrameCallback((_) {
                      if (mounted && _amount.text.isEmpty) setState(() => _amount.text = groupKz(totalOpen));
                    });
                  }
                  final preview = previewAllocation(parseKz(_amount.text), open);
                  return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text(totalOpen > 0 ? 'Em dívida: ${formatKz(totalOpen)}' : 'Sem dívidas — o valor fica como crédito.',
                        style: Theme.of(context).textTheme.titleSmall),
                    const SizedBox(height: 12),
                    KzField(
                      fieldKey: const Key('amount'),
                      controller: _amount,
                      onChanged: (_) => setState(() => _amountTouched = true),
                    ),
                    if (preview.lines.isNotEmpty || preview.credit > 0) ...[
                      const SectionHeader('Vai pagar'),
                      Card(
                        child: Column(children: [
                          for (final line in preview.lines)
                            ListTile(
                              dense: true,
                              leading: Icon(line.settles ? Icons.check_circle : Icons.timelapse, color: line.settles ? Brand.ok : Brand.warn),
                              title: Text(line.charge.title),
                              trailing: Text(line.settles ? formatKz(line.amount) : '${formatKz(line.amount)} de ${formatKz(line.charge.outstanding)}'),
                            ),
                          if (preview.credit > 0)
                            ListTile(
                              dense: true,
                              leading: const Icon(Icons.savings_outlined),
                              title: const Text('Crédito para as próximas semanas'),
                              trailing: Text(formatKz(preview.credit)),
                            ),
                        ]),
                      ),
                    ],
                  ]);
                },
              );
            }),
            const SectionHeader('Como foi pago'),
            MethodPicker(value: _method, onChanged: (value) => setState(() => _method = value)),
            const SizedBox(height: 8),
            DateTimeField(label: 'Recebido em', value: _receivedAt, lastDate: DateTime.now(), onChanged: (value) => setState(() => _receivedAt = value)),
            if (_method != 'numerario')
              TextFormField(controller: _reference, decoration: const InputDecoration(labelText: 'Referência / n.º da transferência')),
            const SizedBox(height: 12),
            PhotoField(label: 'Foto do comprovativo', value: _photo, onChanged: (file) => setState(() => _photo = file)),
            const SizedBox(height: 24),
            FilledButton.icon(
              key: const Key('save_payment'),
              onPressed: _busy ? null : _submit,
              icon: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.check),
              label: Text(_busy ? 'A guardar…' : 'Registar pagamento'),
            ),
          ],
        ]),
      ),
    );
  }
}

class _DriverPicker extends ConsumerWidget {
  const _DriverPicker({required this.value, required this.onChanged});

  final String? value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final drivers = ref.watch(driversProvider);
    return drivers.when(
      loading: () => const LinearProgressIndicator(),
      error: (error, _) => ErrorRetry(error: error, onRetry: () => ref.invalidate(driversProvider)),
      data: (cached) {
        final rows = [...cached.data]..sort((a, b) => asInt(b['overdue']).compareTo(asInt(a['overdue'])));
        final selected = rows.where((row) => row['id'] == value).firstOrNull;
        return Card(
          child: ListTile(
            key: const Key('driver_picker'),
            leading: selected == null ? const Icon(Icons.person_search_outlined) : Avatar('${selected['name']}'),
            title: Text(selected == null ? 'Escolher motorista' : '${selected['name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: selected == null ? null : Text(selected['plate'] == null ? 'Sem viatura' : '${selected['plate']}'),
            trailing: const Icon(Icons.expand_more),
            onTap: () async {
              final picked = await showModalBottomSheet<String>(
                context: context,
                isScrollControlled: true,
                showDragHandle: true,
                builder: (context) => DraggableScrollableSheet(
                  expand: false,
                  initialChildSize: 0.6,
                  builder: (context, controller) => ListView(controller: controller, children: [
                    for (final row in rows)
                      ListTile(
                        leading: Avatar('${row['name']}'),
                        title: Text('${row['name']}'),
                        subtitle: Text(row['plate'] == null ? 'Sem viatura' : '${row['plate']}'),
                        trailing: asInt(row['overdue']) > 0 ? StatusChip('Deve ${formatKz(asInt(row['overdue']))}', tone: Tone.danger) : null,
                        onTap: () => Navigator.pop(context, row['id'] as String),
                      ),
                  ]),
                ),
              );
              if (picked != null) onChanged(picked);
            },
          ),
        );
      },
    );
  }
}
