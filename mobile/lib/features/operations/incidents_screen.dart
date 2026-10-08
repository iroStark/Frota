import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/format/format.dart';
import '../../core/widgets/photo_field.dart';
import '../../core/widgets/widgets.dart';
import '../payments/review_screen.dart' show incidentTypeLabels;
import '../shared/providers.dart';

const incidentStatusLabels = {
  'por_validar': 'Por validar',
  'agendada': 'Agendada',
  'em_curso': 'Em curso',
  'resolvida': 'Resolvida',
  'cancelada': 'Cancelada',
};

Tone incidentTone(String status) => switch (status) {
      'por_validar' => Tone.warn,
      'em_curso' => Tone.danger,
      'agendada' => Tone.info,
      'resolvida' => Tone.ok,
      _ => Tone.neutral,
    };

class IncidentsScreen extends ConsumerStatefulWidget {
  const IncidentsScreen({super.key});

  @override
  ConsumerState<IncidentsScreen> createState() => _IncidentsScreenState();
}

class _IncidentsScreenState extends ConsumerState<IncidentsScreen> {
  String _status = 'todas';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ocorrências')),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('new_incident'),
        onPressed: () => context.push('/ocorrencias/nova'),
        icon: const Icon(Icons.add),
        label: const Text('Nova'),
      ),
      body: Column(children: [
        SizedBox(
          height: 52,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16), children: [
            for (final entry in {'todas': 'Todas', ...incidentStatusLabels}.entries)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(label: Text(entry.value), selected: _status == entry.key, onSelected: (_) => setState(() => _status = entry.key)),
              ),
          ]),
        ),
        Expanded(
          child: CachedBody<List<Map<String, dynamic>>>(
            provider: incidentsProvider(_status),
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
            builder: (context, rows) => rows.isEmpty
                ? [const EmptyState('Sem ocorrências.', icon: Icons.check_circle_outline)]
                : [for (final row in rows) _IncidentCard(row: row)],
          ),
        ),
      ]),
    );
  }
}

class _IncidentCard extends ConsumerWidget {
  const _IncidentCard({required this.row});

  final Map<String, dynamic> row;

  Future<void> _resolve(BuildContext context, WidgetRef ref) async {
    try {
      await ref.read(apiProvider).post<Map<String, dynamic>>('/incidents/${row['id']}/resolve', {});
      invalidateIncidents(ref);
      if (context.mounted) showMessage(context, 'Ocorrência resolvida. As cobranças foram recalculadas.');
    } on ApiException catch (error) {
      if (context.mounted) showMessage(context, error.message);
    }
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref) async {
    final controller = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancelar ocorrência'),
        content: TextField(controller: controller, autofocus: true, decoration: const InputDecoration(hintText: 'Motivo')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Voltar')),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: const Text('Cancelar ocorrência')),
        ],
      ),
    );
    if (reason == null || reason.length < 3 || !context.mounted) return;
    try {
      await ref.read(apiProvider).post<Map<String, dynamic>>('/incidents/${row['id']}/cancel', {'reason': reason});
      invalidateIncidents(ref);
      if (context.mounted) showMessage(context, 'Ocorrência cancelada.');
    } on ApiException catch (error) {
      if (context.mounted) showMessage(context, error.message);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = row['status'] as String;
    final attachments = (row['attachment_ids'] as List? ?? const []).cast<String>();
    final start = DateTime.parse('${row['start_at']}');
    final end = row['end_at'] == null ? null : DateTime.parse('${row['end_at']}');
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ListTile(
          title: Text(incidentTypeLabels[row['type']] ?? '${row['type']}', style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text([
            [row['plate'], row['driver_name']].whereType<String>().join(' · '),
            '${formatDateTime(start)}${end != null ? ' → ${formatDateTime(end)}' : ' → a decorrer'}',
            if (row['exempts_fee'] == true) 'Desconta dias parados',
            if (row['immobilizes'] == true) 'Imobiliza a viatura',
            if (asInt(row['amount']) > 0) 'Valor ${formatKz(asInt(row['amount']))}',
            if (row['notes'] != null) '${row['notes']}',
          ].where((line) => line.isNotEmpty).join('\n')),
          isThreeLine: true,
          trailing: StatusChip(incidentStatusLabels[status] ?? status, tone: incidentTone(status)),
        ),
        if (attachments.isNotEmpty)
          SizedBox(
            height: 90,
            child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16), children: [
              for (final id in attachments)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ClipRRect(borderRadius: BorderRadius.circular(10), child: SizedBox(width: 90, child: AuthImage(id, height: 90))),
                ),
            ]),
          ),
        if (status == 'por_validar' || status == 'em_curso' || status == 'agendada')
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: Row(children: [
              Expanded(child: OutlinedButton(onPressed: () => _cancel(context, ref), child: const Text('Cancelar'))),
              const SizedBox(width: 12),
              Expanded(
                child: status == 'por_validar'
                    ? FilledButton(onPressed: () => context.push('/validar'), child: const Text('Validar'))
                    : FilledButton(onPressed: () => _resolve(context, ref), child: const Text('Resolver')),
              ),
            ]),
          ),
      ]),
    );
  }
}
