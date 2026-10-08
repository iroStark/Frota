import 'package:flutter/material.dart';

const fuelLevels = {
  'vazio': 'Vazio',
  'reserva': 'Reserva',
  'um_quarto': '1/4',
  'meio': '1/2',
  'tres_quartos': '3/4',
  'cheio': 'Cheio',
};

/// Itens conferidos na entrega/devolução (ficam no registo da atribuição).
const handoverItems = {
  'chaves': 'Chaves',
  'livrete': 'Livrete',
  'seguro': 'Seguro',
  'inspecao': 'Inspeção',
  'licenca_taxi': 'Licença de táxi',
  'gps': 'GPS a funcionar',
  'pneu_suplente': 'Pneu suplente',
  'macaco_triangulo': 'Macaco e triângulo',
  'extintor': 'Extintor',
};

class FuelPicker extends StatelessWidget {
  const FuelPicker({super.key, required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final entry in fuelLevels.entries)
            ChoiceChip(label: Text(entry.value), selected: value == entry.key, onSelected: (_) => onChanged(entry.key)),
        ],
      );
}

class ChecklistField extends StatelessWidget {
  const ChecklistField({super.key, required this.values, required this.onChanged});

  final Map<String, bool> values;
  final ValueChanged<Map<String, bool>> onChanged;

  @override
  Widget build(BuildContext context) => Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final entry in handoverItems.entries)
            FilterChip(
              label: Text(entry.value),
              selected: values[entry.key] ?? false,
              onSelected: (selected) => onChanged({...values, entry.key: selected}),
            ),
        ],
      );
}
