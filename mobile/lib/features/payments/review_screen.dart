import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/format/format.dart';
import '../../core/widgets/photo_field.dart';
import '../../core/widgets/widgets.dart';
import '../shared/providers.dart';
import 'common.dart';

const incidentTypeLabels = {
  'doenca': 'Doença / baixa médica',
  'licenca': 'Licença / férias',
  'manutencao': 'Manutenção em oficina',
  'paragem_tecnica': 'Paragem técnica',
  'sinistro': 'Acidente / sinistro',
  'avaria': 'Avaria',
  'multa': 'Multa',
  'fora_horario': 'Fora de horário',
  'vistoria': 'Vistoria',
  'gps': 'GPS / manipulação',
  'furto': 'Furto / roubo',
  'outro': 'Outro',
};

/// Comprovativos e ocorrências enviados pelos motoristas, à espera da decisão do gestor.
class ReviewScreen extends StatelessWidget {
  const ReviewScreen({super.key});

  @override
  Widget build(BuildContext context) => DefaultTabController(
        length: 2,
        child: Scaffold(
          appBar: AppBar(
            title: const Text('Para validar'),
            bottom: const TabBar(tabs: [Tab(text: 'Comprovativos'), Tab(text: 'Ocorrências')]),
          ),
          body: const TabBarView(children: [_DeclarationsTab(), _IncidentsTab()]),
        ),
      );
}

Future<String?> _askReason(BuildContext context, String title) {
  final controller = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: controller,
        autofocus: true,
        maxLines: 3,
        decoration: const InputDecoration(hintText: 'Motivo (o motorista vai ver)'),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
        FilledButton(
          onPressed: () => controller.text.trim().length >= 3 ? Navigator.pop(context, controller.text.trim()) : null,
          child: const Text('Confirmar'),
        ),
      ],
    ),
  );
}

class _DeclarationsTab extends ConsumerWidget {
  const _DeclarationsTab();

  Future<void> _confirm(BuildContext context, WidgetRef ref, Map<String, dynamic> row) async {
    final declared = asInt(row['amount']);
    final controller = TextEditingController(text: groupKz(declared));
    final amount = await showDialog<int>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Confirmar pagamento'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${row['driver_name']} declarou ${formatKz(declared)}. Confirme o valor que entrou na conta:'),
          const SizedBox(height: 12),
          TextField(
            controller: controller,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, KzInputFormatter()],
            decoration: const InputDecoration(suffixText: 'Kz'),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(context, parseKz(controller.text)), child: const Text('Confirmar')),
        ],
      ),
    );
    if (amount == null || amount <= 0 || !context.mounted) return;
    try {
      await ref.read(apiProvider).post<Map<String, dynamic>>('/payment-declarations/${row['id']}/confirm', {'amount': amount});
      invalidateMoney(ref, driverId: row['driver_id'] as String);
      if (context.mounted) showMessage(context, 'Pagamento confirmado.');
    } on ApiException catch (error) {
      if (context.mounted) showMessage(context, error.message);
    }
  }

  Future<void> _reject(BuildContext context, WidgetRef ref, Map<String, dynamic> row) async {
    final reason = await _askReason(context, 'Rejeitar comprovativo');
    if (reason == null || !context.mounted) return;
    try {
      await ref.read(apiProvider).post<Map<String, dynamic>>('/payment-declarations/${row['id']}/reject', {'reason': reason});
      ref.invalidate(pendingDeclarationsProvider);
      ref.invalidate(dashboardProvider);
      if (context.mounted) showMessage(context, 'Comprovativo rejeitado.');
    } on ApiException catch (error) {
      if (context.mounted) showMessage(context, error.message);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) => CachedBody<List<Map<String, dynamic>>>(
        provider: pendingDeclarationsProvider,
        builder: (context, rows) => rows.isEmpty
            ? [const EmptyState('Nenhum comprovativo por confirmar.', icon: Icons.check_circle_outline)]
            : [
                for (final row in rows)
                  Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    clipBehavior: Clip.antiAlias,
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      if (row['proof_file_id'] != null)
                        InkWell(
                          onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
                            builder: (_) => Scaffold(
                              appBar: AppBar(title: const Text('Comprovativo')),
                              body: InteractiveViewer(child: AuthImage(row['proof_file_id'] as String, height: null, fit: BoxFit.contain)),
                            ),
                          )),
                          child: AuthImage(row['proof_file_id'] as String),
                        ),
                      ListTile(
                        title: Text('${row['driver_name']} · ${formatKz(asInt(row['amount']))}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text([
                          '${paymentMethods[row['method']] ?? row['method']} em ${formatDateTime(DateTime.parse('${row['paid_at']}'))}',
                          'Enviado ${formatDateTime(DateTime.parse('${row['submitted_at']}'))}',
                          if (row['reference'] != null) 'Ref. ${row['reference']}',
                        ].join('\n')),
                        isThreeLine: true,
                      ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                        child: Row(children: [
                          Expanded(child: OutlinedButton(onPressed: () => _reject(context, ref, row), child: const Text('Rejeitar'))),
                          const SizedBox(width: 12),
                          Expanded(child: FilledButton(onPressed: () => _confirm(context, ref, row), child: const Text('Confirmar'))),
                        ]),
                      ),
                    ]),
                  ),
              ],
      );
}

class _IncidentsTab extends ConsumerWidget {
  const _IncidentsTab();

  Future<void> _validate(BuildContext context, WidgetRef ref, Map<String, dynamic> row) async {
    var exempts = row['exempts_fee'] == true;
    var immobilizes = row['immobilizes'] == true;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Validar ocorrência'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Descontar dias parados'),
              subtitle: const Text('Os dias parados não são cobrados.'),
              value: exempts,
              onChanged: (value) => setState(() => exempts = value),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Imobilizar a viatura'),
              value: immobilizes,
              onChanged: (value) => setState(() => immobilizes = value),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Validar')),
          ],
        ),
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await ref.read(apiProvider).post<Map<String, dynamic>>('/incidents/${row['id']}/validate', {'exemptsFee': exempts, 'immobilizes': immobilizes});
      ref.invalidate(incidentsToValidateProvider);
      invalidateMoney(ref, driverId: row['driver_id'] as String?);
      if (context.mounted) showMessage(context, 'Ocorrência validada. As cobranças foram recalculadas.');
    } on ApiException catch (error) {
      if (context.mounted) showMessage(context, error.message);
    }
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref, Map<String, dynamic> row) async {
    final reason = await _askReason(context, 'Recusar ocorrência');
    if (reason == null || !context.mounted) return;
    try {
      await ref.read(apiProvider).post<Map<String, dynamic>>('/incidents/${row['id']}/cancel', {'reason': reason});
      ref.invalidate(incidentsToValidateProvider);
      ref.invalidate(dashboardProvider);
      if (context.mounted) showMessage(context, 'Ocorrência recusada.');
    } on ApiException catch (error) {
      if (context.mounted) showMessage(context, error.message);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) => CachedBody<List<Map<String, dynamic>>>(
        provider: incidentsToValidateProvider,
        builder: (context, rows) => rows.isEmpty
            ? [const EmptyState('Nenhuma ocorrência por validar.', icon: Icons.check_circle_outline)]
            : [
                for (final row in rows)
                  Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      ListTile(
                        leading: const Icon(Icons.report_outlined),
                        title: Text('${incidentTypeLabels[row['type']] ?? row['type']} · ${row['driver_name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text([
                          'De ${formatDateTime(DateTime.parse('${row['start_at']}'))}'
                              '${row['end_at'] != null ? ' a ${formatDateTime(DateTime.parse('${row['end_at']}'))}' : ' (sem fim)'}',
                          'Comunicada ${formatDateTime(DateTime.parse('${row['reported_at']}'))}',
                          if (row['notes'] != null) '${row['notes']}',
                        ].join('\n')),
                        isThreeLine: true,
                      ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                        child: Row(children: [
                          Expanded(child: OutlinedButton(onPressed: () => _cancel(context, ref, row), child: const Text('Recusar'))),
                          const SizedBox(width: 12),
                          Expanded(child: FilledButton(onPressed: () => _validate(context, ref, row), child: const Text('Validar'))),
                        ]),
                      ),
                    ]),
                  ),
              ],
      );
}
