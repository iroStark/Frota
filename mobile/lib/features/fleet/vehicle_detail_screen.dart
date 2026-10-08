import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format/format.dart';
import '../../core/widgets/photo_field.dart';
import '../../core/widgets/widgets.dart';
import '../driver/driver_screens.dart' show validityChip;
import '../payments/review_screen.dart' show incidentTypeLabels;
import '../shared/providers.dart';
import 'handover.dart';

const vehicleStatusLabels = {'em_servico': 'Em serviço', 'disponivel': 'Disponível', 'imobilizada': 'Imobilizada', 'abatida': 'Abatida'};

Tone vehicleStatusTone(String status) => switch (status) {
      'em_servico' => Tone.ok,
      'imobilizada' => Tone.danger,
      'abatida' => Tone.neutral,
      _ => Tone.warn,
    };

class VehicleDetailScreen extends ConsumerWidget {
  const VehicleDetailScreen({super.key, required this.vehicleId});

  final String vehicleId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(vehicleDetailProvider(vehicleId)).value?.data;
    return Scaffold(
      appBar: AppBar(
        title: Text(detail == null ? 'Viatura' : '${detail['brand']} ${detail['model']}'),
        actions: [
          if (detail != null)
            IconButton(
              tooltip: 'Editar',
              onPressed: () => context.push('/viaturas/$vehicleId/editar', extra: detail),
              icon: const Icon(Icons.edit_outlined),
            ),
        ],
      ),
      body: CachedBody<Map<String, dynamic>>(
        provider: vehicleDetailProvider(vehicleId),
        builder: (context, vehicle) {
          final status = vehicle['status'] as String;
          final active = vehicle['activeAssignment'] as Map?;
          final handover = active?['handover'] as Map?;
          final documents = (vehicle['documents'] as List? ?? const []).cast<Map>();
          final incidents = (vehicle['incidents'] as List? ?? const []).cast<Map>();
          final history = (vehicle['assignments'] as List? ?? const []).cast<Map>().where((a) => a['status'] != 'ativa').toList();
          final expenses = vehicle['expenseTotals'] as Map? ?? const {};
          return [
            if (vehicle['photo_file_id'] != null)
              ClipRRect(borderRadius: BorderRadius.circular(20), child: AuthImage(vehicle['photo_file_id'] as String, height: 180)),
            if (vehicle['photo_file_id'] != null) const SizedBox(height: 12),
            Card(
              child: ListTile(
                leading: const CircleAvatar(child: Icon(Icons.local_taxi)),
                title: Text('${vehicle['plate'] ?? 'Sem matrícula'}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
                subtitle: Text([
                  if (vehicle['year'] != null) '${vehicle['year']}',
                  if (vehicle['color'] != null) '${vehicle['color']}',
                  if (vehicle['mileage'] != null) '${groupInt(asInt(vehicle['mileage']))} km',
                ].join(' · ')),
                trailing: StatusChip(vehicleStatusLabels[status] ?? status, tone: vehicleStatusTone(status)),
              ),
            ),
            const SectionHeader('Motorista'),
            if (active != null)
              Card(
                child: Column(children: [
                  ListTile(
                    leading: Avatar('${active['driver_name']}'),
                    title: Text('${active['driver_name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text('Desde ${formatDate(DateTime.parse('${active['start_at']}'))} · ${formatKz(asInt(active['weekly_fee']))}/semana'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.push('/motoristas/${active['driver_id']}'),
                  ),
                  if (handover != null && handover['fuelLevel'] != null)
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.fact_check_outlined),
                      title: Text('Entregue com ${fuelLevels[handover['fuelLevel']] ?? handover['fuelLevel']} de combustível'
                          '${handover['mileage'] != null ? ' e ${groupInt(asInt(handover['mileage']))} km' : ''}'),
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                    child: OutlinedButton.icon(
                      key: const Key('return_vehicle'),
                      onPressed: () => context.push('/devolver', extra: <String, dynamic>{...Map<String, dynamic>.from(active), 'vehicle_id': vehicleId}),
                      icon: const Icon(Icons.assignment_return_outlined),
                      label: const Text('Devolver viatura'),
                    ),
                  ),
                ]),
              )
            else
              Card(
                child: Column(children: [
                  ListTile(
                    leading: const Icon(Icons.person_off_outlined),
                    title: const Text('Sem motorista'),
                    subtitle: status == 'disponivel' ? null : Text('Não pode ser atribuída: ${vehicleStatusLabels[status] ?? status}.'),
                  ),
                  if (status == 'disponivel')
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                      // Os FilledButton do tema ocupam a largura toda: fora de um ListTile.
                      child: FilledButton.icon(
                        key: const Key('assign_vehicle'),
                        onPressed: () => context.push('/atribuir?viatura=$vehicleId'),
                        icon: const Icon(Icons.key_outlined),
                        label: const Text('Atribuir a um motorista'),
                      ),
                    ),
                ]),
              ),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => context.push('/ocorrencias/nova?viatura=$vehicleId'),
                  icon: const Icon(Icons.report_outlined),
                  label: const Text('Ocorrência'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => context.push('/documentos/novo?dono=vehicle&id=$vehicleId'),
                  icon: const Icon(Icons.upload_file_outlined),
                  label: const Text('Documento'),
                ),
              ),
            ]),
            const SectionHeader('Documentos'),
            if (documents.isEmpty) const EmptyState('Sem documentos registados.', icon: Icons.description_outlined),
            for (final doc in documents)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: const Icon(Icons.description_outlined),
                  title: Text('${doc['type']}'.replaceAll('_', ' ')),
                  subtitle: Text(doc['valid_until'] != null ? 'Validade ${formatDay('${doc['valid_until']}')}' : '${doc['number'] ?? ''}'),
                  trailing: validityChip(doc['validity'] as String?),
                ),
              ),
            const SectionHeader('Despesas'),
            Row(children: [
              Expanded(child: KpiCard(label: 'Da proprietária', value: formatKz(asInt(expenses['owner_total'])))),
              const SizedBox(width: 12),
              Expanded(child: KpiCard(label: 'Do motorista', value: formatKz(asInt(expenses['driver_total'])))),
            ]),
            if (incidents.isNotEmpty) ...[
              const SectionHeader('Ocorrências'),
              for (final incident in incidents.take(10))
                Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    leading: const Icon(Icons.report_outlined),
                    title: Text(incidentTypeLabels[incident['type']] ?? '${incident['type']}'),
                    subtitle: Text(formatDate(DateTime.parse('${incident['start_at']}'))),
                    trailing: StatusChip('${incident['status']}'.replaceAll('_', ' ')),
                  ),
                ),
            ],
            if (history.isNotEmpty) ...[
              const SectionHeader('Histórico de motoristas'),
              for (final assignment in history)
                Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    leading: Avatar('${assignment['driver_name']}', radius: 16),
                    title: Text('${assignment['driver_name']}'),
                    subtitle: Text('${formatDate(DateTime.parse('${assignment['start_at']}'))} – '
                        '${assignment['end_at'] != null ? formatDate(DateTime.parse('${assignment['end_at']}')) : ''}'),
                  ),
                ),
            ],
          ];
        },
      ),
    );
  }
}

String groupInt(int value) => formatKz(value).replaceAll(' Kz', '');
