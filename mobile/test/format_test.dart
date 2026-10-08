import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:uhocha_frota/core/format/format.dart';
import 'package:uhocha_frota/features/payments/common.dart';

void main() {
  setUpAll(() => initializeDateFormatting('pt_PT'));

  test('kwanzas com separador de milhares sem quebra', () {
    expect(formatKz(130000), '130 000 Kz');
    expect(formatKz(86666.6), '86 667 Kz');
    expect(formatKz(0), '0 Kz');
  });

  test('hora de Luanda independentemente do fuso do telemóvel', () {
    final local = toLuanda(DateTime.utc(2026, 10, 5, 11));
    expect(local.hour, 12);
    expect(toLuanda(DateTime.utc(2026, 10, 4, 23, 30)).day, 5);
  });

  test('semana e contagem do prazo', () {
    expect(formatWeek('2026-09-28'), '28 set. – 4 out.');
    expect(formatDay('2026-10-05'), '5 out.');
    expect(formatDateTime(DateTime.utc(2026, 10, 5, 11)), '5 out., 12:00');
    final now = DateTime.utc(2026, 10, 5, 9);
    expect(formatCountdown(DateTime.utc(2026, 10, 5, 11), now: now), 'faltam 2 h 0 min');
    expect(formatCountdown(DateTime.utc(2026, 10, 3, 9), now: now), 'venceu há 2 d 0 h');
  });

  test('saudação pela hora de Luanda', () {
    expect(greeting(DateTime.utc(2026, 10, 5, 7)), 'Bom dia');
    expect(greeting(DateTime.utc(2026, 10, 5, 13)), 'Boa tarde');
    expect(greeting(DateTime.utc(2026, 10, 5, 20)), 'Boa noite');
  });

  test('valores escritos com separador de milhares', () {
    final formatter = KzInputFormatter();
    final value = formatter.formatEditUpdate(TextEditingValue.empty, const TextEditingValue(text: '1300000'));
    expect(value.text, '1\u00A0300\u00A0000');
    expect(parseKz(value.text), 1300000);
    expect(parseKz(''), 0);
  });
}
