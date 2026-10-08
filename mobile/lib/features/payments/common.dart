import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/format/format.dart';

const paymentMethods = {
  'numerario': 'Numerário',
  'transferencia': 'Transferência',
  'multicaixa': 'Multicaixa',
  'deposito': 'Depósito',
};

/// Lê um valor escrito com separadores ("130 000") como inteiro.
int parseKz(String text) => int.tryParse(text.replaceAll(RegExp(r'\D'), '')) ?? 0;

/// Mostra os milhares enquanto se escreve: 130000 → "130 000".
class KzInputFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final digits = newValue.text.replaceAll(RegExp(r'\D'), '');
    if (digits.isEmpty) return const TextEditingValue();
    final formatted = groupKz(int.parse(digits));
    return TextEditingValue(text: formatted, selection: TextSelection.collapsed(offset: formatted.length));
  }
}

String groupKz(int value) => formatKz(value).replaceAll('\u00A0Kz', '');

/// Campo de valor em kwanzas (só dígitos, com separador de milhares).
class KzField extends StatelessWidget {
  const KzField({super.key, required this.controller, this.label = 'Valor recebido', this.onChanged, this.fieldKey, this.allowZero = false});

  final TextEditingController controller;
  final String label;
  final ValueChanged<String>? onChanged;
  final Key? fieldKey;
  final bool allowZero;

  @override
  Widget build(BuildContext context) => TextFormField(
        key: fieldKey,
        controller: controller,
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(9), KzInputFormatter()],
        style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
        decoration: InputDecoration(labelText: label, suffixText: 'Kz'),
        onChanged: onChanged,
        validator: (value) => !allowZero && parseKz(value ?? '') <= 0 ? 'Indique um valor maior que zero.' : null,
      );
}

class MethodPicker extends StatelessWidget {
  const MethodPicker({super.key, required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => Wrap(
        spacing: 8,
        runSpacing: 8,
        children: paymentMethods.entries
            .map((entry) => ChoiceChip(
                  label: Text(entry.value),
                  selected: value == entry.key,
                  onSelected: (_) => onChanged(entry.key),
                ))
            .toList(),
      );
}

/// Data e hora (Luanda) com seletores do sistema.
class DateTimeField extends StatelessWidget {
  const DateTimeField({super.key, required this.label, required this.value, required this.onChanged, this.lastDate});

  final String label;
  final DateTime value;
  final ValueChanged<DateTime> onChanged;
  final DateTime? lastDate;

  Future<void> _pick(BuildContext context) async {
    final date = await showDatePicker(
      context: context,
      initialDate: value,
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: lastDate ?? DateTime.now().add(const Duration(days: 365)),
    );
    if (date == null || !context.mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(value));
    if (time == null) return;
    onChanged(DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  @override
  Widget build(BuildContext context) => ListTile(
        contentPadding: EdgeInsets.zero,
        leading: const Icon(Icons.event_outlined),
        title: Text(label),
        subtitle: Text(formatDateTime(value)),
        trailing: const Icon(Icons.edit_calendar_outlined),
        onTap: () => _pick(context),
      );
}
