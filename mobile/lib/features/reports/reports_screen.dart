import 'dart:io';

import 'package:dio/dio.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../app/theme.dart';
import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/format/format.dart';
import '../../core/widgets/widgets.dart';
import '../operations/expenses_screen.dart' show expenseCategories;
import '../payments/common.dart';
import '../shared/providers.dart';

class ReportPeriod {
  const ReportPeriod(this.label, this.from, this.to);

  final String label;
  final DateTime from;
  final DateTime to;

  String get key => '${isoDay(from)}|${isoDay(to)}';

  static List<ReportPeriod> presets(DateTime now) {
    final today = DateTime(now.year, now.month, now.day);
    final monthStart = DateTime(now.year, now.month);
    return [
      ReportPeriod('Este mês', monthStart, today),
      ReportPeriod('Mês passado', DateTime(now.year, now.month - 1), monthStart.subtract(const Duration(days: 1))),
      ReportPeriod('3 meses', DateTime(now.year, now.month - 2), today),
      ReportPeriod('Este ano', DateTime(now.year), today),
    ];
  }
}

class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});

  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen> {
  late final _presets = ReportPeriod.presets(DateTime.now());
  late ReportPeriod _period = _presets.first;
  bool _exporting = false;

  Future<void> _exportCsv() async {
    setState(() => _exporting = true);
    try {
      final api = ref.read(apiProvider);
      final response = await api.dio.get<List<int>>(
        '/reports/movements.csv',
        queryParameters: {'from': isoDay(_period.from), 'to': isoDay(_period.to)},
        options: Options(responseType: ResponseType.bytes),
      );
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/uhocha-movimentos-${isoDay(_period.from)}-a-${isoDay(_period.to)}.csv');
      await file.writeAsBytes(response.data!);
      await SharePlus.instance.share(ShareParams(files: [XFile(file.path, mimeType: 'text/csv')], subject: 'Movimentos UHOCHA'));
    } on DioException catch (error) {
      if (mounted) showMessage(context, ApiException.fromDio(error).message);
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Relatórios'), actions: [
        IconButton(
          tooltip: 'Exportar CSV',
          onPressed: _exporting ? null : _exportCsv,
          icon: _exporting ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.ios_share),
        ),
      ]),
      body: Column(children: [
        SizedBox(
          height: 52,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16), children: [
            for (final preset in _presets)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(label: Text(preset.label), selected: preset.key == _period.key, onSelected: (_) => setState(() => _period = preset)),
              ),
          ]),
        ),
        Expanded(
          child: CachedBody<Map<String, dynamic>>(
            provider: reportProvider(_period.key),
            builder: (context, report) {
              final totals = Map<String, dynamic>.from(report['totals'] as Map);
              final weeks = (report['weeks'] as List).cast<Map>();
              final drivers = (report['drivers'] as List).cast<Map>().toList()..sort((a, b) => asInt(b['outstanding']).compareTo(asInt(a['outstanding'])));
              final vehicles = (report['vehicles'] as List).cast<Map>();
              final categories = (report['expensesByCategory'] as List).cast<Map>();
              return [
                Text('${formatDay(isoDay(_period.from))} – ${formatDay(isoDay(_period.to))}', style: Theme.of(context).textTheme.bodySmall),
                const SizedBox(height: 8),
                KpiCard(
                  label: 'Líquido do período',
                  value: formatKz(asInt(totals['net'])),
                  caption: 'Recebido ${formatKz(asInt(totals['received']))} − despesas ${formatKz(asInt(totals['ownerExpenses']))}',
                  highlight: true,
                ),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(child: KpiCard(label: 'Taxa de cobrança', value: '${totals['collectionRate']}%', caption: 'das entregas semanais')),
                  const SizedBox(width: 12),
                  Expanded(child: KpiCard(label: 'Multas e penalidades', value: formatKz(asInt(totals['otherCharged'])))),
                ]),
                if (weeks.isNotEmpty) ...[
                  const SectionHeader('Esperado e recebido por semana'),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(8, 16, 16, 8),
                      child: SizedBox(height: 200, child: _WeeksChart(weeks: weeks)),
                    ),
                  ),
                  const Padding(
                    padding: EdgeInsets.only(top: 6),
                    child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                      _Legend(color: Color(0xFFD0D3D8), label: 'Esperado'),
                      SizedBox(width: 16),
                      _Legend(color: Brand.graphite, label: 'Recebido'),
                    ]),
                  ),
                ],
                const SectionHeader('Motoristas'),
                if (drivers.isEmpty) const EmptyState('Sem cobranças neste período.'),
                for (final driver in drivers)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      leading: Avatar('${driver['name']}'),
                      title: Text('${driver['name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text('Cobrado ${formatKz(asInt(driver['weeklyCharged']) + asInt(driver['penaltiesAndFines']))} · pago ${formatKz(asInt(driver['paid']))}'
                          '${asInt(driver['lateWeeks']) > 0 ? ' · ${driver['lateWeeks']} atraso(s)' : ''}'),
                      trailing: asInt(driver['outstanding']) > 0
                          ? StatusChip('Falta ${formatKz(asInt(driver['outstanding']))}', tone: Tone.danger)
                          : const StatusChip('Em dia', tone: Tone.ok),
                    ),
                  ),
                const SectionHeader('Viaturas'),
                if (vehicles.isEmpty) const EmptyState('Sem movimentos de viaturas.'),
                for (final vehicle in vehicles)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      title: Text('${vehicle['plate'] ?? vehicle['name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text('Recebido ${formatKz(asInt(vehicle['paid']))} · despesas ${formatKz(asInt(vehicle['ownerExpenses']))}'),
                      trailing: Text(formatKz(asInt(vehicle['net'])),
                          style: TextStyle(fontWeight: FontWeight.w800, color: asInt(vehicle['net']) < 0 ? Brand.danger : null)),
                    ),
                  ),
                if (categories.isNotEmpty) ...[
                  const SectionHeader('Despesas por categoria'),
                  Card(
                    child: Column(children: [
                      for (final category in categories)
                        ListTile(
                          dense: true,
                          title: Text(expenseCategories[category['category']] ?? '${category['category']}'),
                          trailing: Text(formatKz(asInt(category['total']))),
                        ),
                    ]),
                  ),
                ],
              ];
            },
          ),
        ),
      ]),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 12, height: 12, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3))),
        const SizedBox(width: 6),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
      ]);
}

class _WeeksChart extends StatelessWidget {
  const _WeeksChart({required this.weeks});

  final List<Map> weeks;

  @override
  Widget build(BuildContext context) {
    final maxY = weeks.fold<int>(0, (max, w) => asInt(w['expected']) > max ? asInt(w['expected']) : max).toDouble();
    return BarChart(
      BarChartData(
        maxY: maxY == 0 ? 1 : maxY * 1.15,
        gridData: const FlGridData(show: false),
        borderData: FlBorderData(show: false),
        barTouchData: BarTouchData(
          touchTooltipData: BarTouchTooltipData(
            getTooltipItem: (group, _, rod, rodIndex) => BarTooltipItem(
              '${rodIndex == 0 ? 'Esperado' : 'Recebido'}\n${formatKz(rod.toY)}',
              const TextStyle(color: Colors.white, fontSize: 12),
            ),
          ),
        ),
        titlesData: FlTitlesData(
          leftTitles: const AxisTitles(),
          rightTitles: const AxisTitles(),
          topTitles: const AxisTitles(),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 28,
              getTitlesWidget: (value, meta) {
                final index = value.toInt();
                if (index < 0 || index >= weeks.length) return const SizedBox.shrink();
                // Com muitas semanas, mostrar só algumas etiquetas.
                if (weeks.length > 8 && index % (weeks.length ~/ 6) != 0) return const SizedBox.shrink();
                return SideTitleWidget(meta: meta, child: Text(formatDay('${weeks[index]['week']}'), style: const TextStyle(fontSize: 10)));
              },
            ),
          ),
        ),
        barGroups: [
          for (final (index, week) in weeks.indexed)
            BarChartGroupData(x: index, barsSpace: 3, barRods: [
              BarChartRodData(toY: asInt(week['expected']).toDouble(), color: const Color(0xFFD0D3D8), width: weeks.length > 10 ? 5 : 10, borderRadius: BorderRadius.circular(3)),
              BarChartRodData(toY: asInt(week['paid']).toDouble(), color: Brand.graphite, width: weeks.length > 10 ? 5 : 10, borderRadius: BorderRadius.circular(3)),
            ]),
        ],
      ),
    );
  }
}
