import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/auth/session.dart';
import '../../core/format/format.dart';
import '../../core/widgets/widgets.dart';
import '../shared/models.dart';
import '../shared/providers.dart';

Tone _severityTone(String severity) => switch (severity) {
      'danger' => Tone.danger,
      'warn' => Tone.warn,
      _ => Tone.info,
    };

Tone chargeTone(String status, {bool overdue = false}) => switch (status) {
      'paga' => Tone.ok,
      'isenta' => Tone.neutral,
      'parcial' => Tone.warn,
      _ => overdue ? Tone.danger : Tone.warn,
    };

String chargeStatusLabel(String status) => const {
      'aberta': 'Em falta',
      'parcial': 'Parcial',
      'paga': 'Paga',
      'isenta': 'Isenta',
      'anulada': 'Anulada',
    }[status] ??
    status;

class StaffHomeScreen extends ConsumerWidget {
  const StaffHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionProvider).user;
    return Scaffold(
      appBar: AppBar(
        title: Text('${greeting()}, ${user?.firstName ?? ''}'),
        actions: [
          IconButton(tooltip: 'Alertas', onPressed: () => context.push('/alertas'), icon: const Icon(Icons.notifications_outlined)),
        ],
      ),
      body: CachedBody<Dashboard>(
        provider: dashboardProvider,
        builder: (context, data) => [
          _BillingWeekCard(data: data),
          if (data.declarationsToReview + data.incidentsToReview > 0) ...[
            const SizedBox(height: 12),
            Card(
              child: ListTile(
                leading: const Icon(Icons.fact_check_outlined),
                title: const Text('Para validar'),
                subtitle: Text('${data.declarationsToReview} comprovativo(s) · ${data.incidentsToReview} ocorrência(s)'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/em-breve?titulo=Para validar'),
              ),
            ),
          ],
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: KpiCard(label: 'Dívida em atraso', value: formatKz(data.debtTotal), caption: '${data.debtDrivers} motorista(s)')),
            const SizedBox(width: 12),
            Expanded(child: KpiCard(label: 'Líquido do mês', value: formatKz(data.monthNet), caption: 'Recebido ${formatKz(data.monthReceived)}')),
          ]),
          const SizedBox(height: 12),
          _VehicleStatusRow(counts: data.vehicles),
          SectionHeader('Alertas', trailing: Text('${data.alerts.length}')),
          if (data.alerts.isEmpty) const EmptyState('Sem alertas. Tudo em dia.', icon: Icons.check_circle_outline),
          ...data.alerts.take(6).map((alert) => _AlertTile(alert: alert)),
          if (data.alerts.length > 6)
            TextButton(onPressed: () => context.push('/alertas'), child: Text('Ver todos (${data.alerts.length})')),
        ],
      ),
    );
  }
}

class _BillingWeekCard extends StatelessWidget {
  const _BillingWeekCard({required this.data});

  final Dashboard data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final late = data.dueAt.isBefore(DateTime.now()) && data.outstanding > 0;
    return Card(
      color: Brand.lime,
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Text('ENTREGA DA SEMANA ${formatWeek(data.periodStart).toUpperCase()}',
                  style: theme.textTheme.labelSmall?.copyWith(color: Brand.graphite.withValues(alpha: 0.7), letterSpacing: 0.6)),
            ),
            Text('${data.progress}%', style: theme.textTheme.titleMedium?.copyWith(color: Brand.graphite, fontWeight: FontWeight.w800)),
          ]),
          const SizedBox(height: 8),
          Text(formatKz(data.paid), style: theme.textTheme.headlineMedium?.copyWith(color: Brand.graphite, fontWeight: FontWeight.w800)),
          Text('de ${formatKz(data.expected)} esperados', style: const TextStyle(color: Brand.graphite)),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: data.progress / 100,
              minHeight: 8,
              color: Brand.graphite,
              backgroundColor: Brand.graphite.withValues(alpha: 0.15),
            ),
          ),
          const SizedBox(height: 12),
          Row(children: [
            Icon(late ? Icons.warning_amber_rounded : Icons.schedule, size: 18, color: late ? Brand.danger : Brand.graphite),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                data.outstanding > 0
                    ? 'Faltam ${formatKz(data.outstanding)} · prazo ${formatDateTime(data.dueAt)} (${formatCountdown(data.dueAt)})'
                    : 'Semana totalmente recebida.',
                style: TextStyle(color: late ? Brand.danger : Brand.graphite, fontWeight: late ? FontWeight.w700 : FontWeight.w500),
              ),
            ),
          ]),
        ]),
      ),
    );
  }
}

class _VehicleStatusRow extends StatelessWidget {
  const _VehicleStatusRow({required this.counts});

  final Map<String, int> counts;

  @override
  Widget build(BuildContext context) {
    const labels = {'em_servico': 'Em serviço', 'disponivel': 'Disponíveis', 'imobilizada': 'Imobilizadas'};
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: Row(
          children: labels.entries
              .map((entry) => Expanded(
                    child: Column(children: [
                      Text('${counts[entry.key] ?? 0}', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
                      Text(entry.value, style: Theme.of(context).textTheme.bodySmall),
                    ]),
                  ))
              .toList(),
        ),
      ),
    );
  }
}

class _AlertTile extends StatelessWidget {
  const _AlertTile({required this.alert});

  final AlertItem alert;

  @override
  Widget build(BuildContext context) {
    final tone = _severityTone(alert.severity);
    final color = toneColor(tone, Theme.of(context).colorScheme);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        child: ListTile(
          leading: Icon(alert.severity == 'info' ? Icons.info_outline : Icons.warning_amber_rounded, color: color),
          title: Text(alert.title, style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text(alert.detail),
          onTap: alert.targetType == 'driver' ? () => context.push('/em-breve?titulo=${Uri.encodeComponent(alert.title)}') : null,
        ),
      ),
    );
  }
}

class AlertsScreen extends ConsumerWidget {
  const AlertsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        appBar: AppBar(title: const Text('Alertas')),
        body: CachedBody<Dashboard>(
          provider: dashboardProvider,
          builder: (context, data) => data.alerts.isEmpty
              ? [const EmptyState('Sem alertas.', icon: Icons.check_circle_outline)]
              : data.alerts.map((alert) => _AlertTile(alert: alert)).toList(),
        ),
      );
}

/// Cobranças da semana que acabou de vencer. Receber pagamento chega na Fase 4.
class ChargesScreen extends ConsumerWidget {
  const ChargesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        appBar: AppBar(title: const Text('Cobranças')),
        body: CachedBody<Dashboard>(
          provider: dashboardProvider,
          builder: (context, data) {
            final charges = [...data.weekCharges]..sort((a, b) => b.outstanding.compareTo(a.outstanding));
            final now = DateTime.now();
            return [
              Text('Semana ${formatWeek(data.periodStart)}', style: Theme.of(context).textTheme.titleMedium),
              Text('Prazo ${formatDateTime(data.dueAt)} · ${formatCountdown(data.dueAt)}', style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 12),
              if (charges.isEmpty) const EmptyState('Ainda não há cobranças para esta semana.'),
              ...charges.map((charge) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Card(
                      child: ListTile(
                        leading: Avatar(charge.driverName),
                        title: Text(charge.driverName, style: const TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Text(charge.paid > 0 && charge.outstanding > 0
                            ? 'Falta ${formatKz(charge.outstanding)} de ${formatKz(charge.amount)}'
                            : formatKz(charge.amount)),
                        trailing: StatusChip(chargeStatusLabel(charge.status), tone: chargeTone(charge.status, overdue: charge.dueAt.isBefore(now))),
                      ),
                    ),
                  )),
            ];
          },
        ),
      );
}

class FleetScreen extends ConsumerStatefulWidget {
  const FleetScreen({super.key});

  @override
  ConsumerState<FleetScreen> createState() => _FleetScreenState();
}

class _FleetScreenState extends ConsumerState<FleetScreen> {
  int _tab = 0;
  String _query = '';

  bool _matches(Map<String, dynamic> row, List<String> fields) =>
      _query.isEmpty || fields.any((field) => '${row[field] ?? ''}'.toLowerCase().contains(_query.toLowerCase()));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Frota')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: SegmentedButton<int>(
            segments: const [
              ButtonSegment(value: 0, label: Text('Viaturas'), icon: Icon(Icons.local_taxi_outlined)),
              ButtonSegment(value: 1, label: Text('Motoristas'), icon: Icon(Icons.badge_outlined)),
            ],
            selected: {_tab},
            onSelectionChanged: (value) => setState(() => _tab = value.first),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: TextField(
            decoration: const InputDecoration(hintText: 'Pesquisar', prefixIcon: Icon(Icons.search)),
            onChanged: (value) => setState(() => _query = value.trim()),
          ),
        ),
        Expanded(
          child: _tab == 0
              ? CachedBody<List<Map<String, dynamic>>>(
                  provider: vehiclesProvider,
                  builder: (context, rows) {
                    final visible = rows.where((row) => _matches(row, ['plate', 'brand', 'model', 'driver_name'])).toList();
                    if (visible.isEmpty) return [const EmptyState('Sem viaturas.')];
                    return visible.map((row) => _VehicleTile(row: row)).toList();
                  },
                )
              : CachedBody<List<Map<String, dynamic>>>(
                  provider: driversProvider,
                  builder: (context, rows) {
                    final visible = rows.where((row) => _matches(row, ['name', 'phone', 'plate'])).toList();
                    if (visible.isEmpty) return [const EmptyState('Sem motoristas.')];
                    return visible.map((row) => _DriverTile(row: row)).toList();
                  },
                ),
        ),
      ]),
    );
  }
}

class _VehicleTile extends StatelessWidget {
  const _VehicleTile({required this.row});

  final Map<String, dynamic> row;

  @override
  Widget build(BuildContext context) {
    final status = row['status'] as String;
    final tone = switch (status) { 'em_servico' => Tone.ok, 'imobilizada' => Tone.danger, 'abatida' => Tone.neutral, _ => Tone.warn };
    const labels = {'em_servico': 'Em serviço', 'disponivel': 'Disponível', 'imobilizada': 'Imobilizada', 'abatida': 'Abatida'};
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        child: ListTile(
          leading: const CircleAvatar(child: Icon(Icons.local_taxi)),
          title: Text('${row['brand']} ${row['model']}', style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text([row['plate'] ?? 'Sem matrícula', row['driver_name'] ?? 'Sem motorista'].join(' · ')),
          trailing: StatusChip(labels[status] ?? status, tone: tone),
        ),
      ),
    );
  }
}

class _DriverTile extends StatelessWidget {
  const _DriverTile({required this.row});

  final Map<String, dynamic> row;

  @override
  Widget build(BuildContext context) {
    final overdue = asInt(row['overdue']);
    final balance = asInt(row['balance']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        child: ListTile(
          leading: Avatar('${row['name']}'),
          title: Text('${row['name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text(row['plate'] != null ? '${row['brand']} ${row['model']} · ${row['plate']}' : 'Sem viatura'),
          trailing: overdue > 0
              ? StatusChip('Deve ${formatKz(overdue)}', tone: Tone.danger)
              : balance < 0
                  ? StatusChip('Crédito ${formatKz(-balance)}', tone: Tone.ok)
                  : const StatusChip('Em dia', tone: Tone.ok),
        ),
      ),
    );
  }
}
