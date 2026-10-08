import 'package:intl/intl.dart';

/// A operação é em Luanda (UTC+1, sem horário de verão), independentemente do fuso do telemóvel.
const _luandaOffset = Duration(hours: 1);

DateTime toLuanda(DateTime value) {
  final utc = value.toUtc().add(_luandaOffset);
  return DateTime(utc.year, utc.month, utc.day, utc.hour, utc.minute, utc.second);
}

final _kz = NumberFormat('#,##0', 'pt_PT');

/// 130000 → "130 000 Kz".
String formatKz(num value) {
  final grouped = _kz.format(value.round()).replaceAll(RegExp(r'[\s  .]'), ' ');
  return '$grouped Kz';
}

String formatDate(DateTime value) => DateFormat("d MMM y", 'pt_PT').format(toLuanda(value));

String formatDateTime(DateTime value) => DateFormat("d MMM, HH:mm", 'pt_PT').format(toLuanda(value));

/// Dia local "2026-10-05" → "5 out".
String formatDay(String isoDay) => DateFormat('d MMM', 'pt_PT').format(DateTime.parse(isoDay));

/// Semana "2026-09-28" → "28 set – 4 out".
String formatWeek(String weekStart) {
  final start = DateTime.parse(weekStart);
  final end = start.add(const Duration(days: 6));
  return '${DateFormat('d MMM', 'pt_PT').format(start)} – ${DateFormat('d MMM', 'pt_PT').format(end)}';
}

/// Tempo até um prazo: "faltam 2 d 4 h", "faltam 35 min" ou "venceu há 3 h".
String formatCountdown(DateTime deadline, {DateTime? now}) {
  final diff = deadline.difference(now ?? DateTime.now());
  final abs = diff.abs();
  final text = abs.inDays >= 1
      ? '${abs.inDays} d ${abs.inHours % 24} h'
      : abs.inHours >= 1
          ? '${abs.inHours} h ${abs.inMinutes % 60} min'
          : '${abs.inMinutes} min';
  return diff.isNegative ? 'venceu há $text' : 'faltam $text';
}

String greeting([DateTime? now]) {
  final hour = toLuanda(now ?? DateTime.now()).hour;
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 19) return 'Boa tarde';
  return 'Boa noite';
}

int asInt(Object? value) => value is num ? value.round() : int.tryParse('$value') ?? 0;
