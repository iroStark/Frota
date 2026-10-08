import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/format/format.dart';
import '../../core/widgets/widgets.dart';
import '../payments/common.dart';
import '../shared/providers.dart';

/// Regras do contrato em vigor e histórico. O admin cria uma nova versão que vale a partir de uma data
/// (as semanas já cobradas não mudam).
class ContractScreen extends ConsumerWidget {
  const ContractScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isAdmin = ref.watch(sessionProvider).user?.role == Role.admin;
    return Scaffold(
      appBar: AppBar(title: const Text('Contrato e valores')),
      floatingActionButton: isAdmin
          ? FloatingActionButton.extended(
              key: const Key('edit_contract'),
              onPressed: () {
                final current = ref.read(contractRulesProvider).value?.data;
                if (current != null) {
                  Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ContractFormScreen(current: current)));
                }
              },
              icon: const Icon(Icons.edit_outlined),
              label: const Text('Alterar valores'),
            )
          : null,
      body: CachedBody<Map<String, dynamic>>(
        provider: contractRulesProvider,
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
        builder: (context, rules) {
          final history = ref.watch(contractHistoryProvider).value?.data ?? const [];
          Widget row(String label, String value) => ListTile(dense: true, title: Text(label), trailing: Text(value, style: const TextStyle(fontWeight: FontWeight.w700)));
          return [
            Card(
              child: Column(children: [
                row('Entrega semanal', formatKz(asInt(rules['weeklyFee']))),
                row('Por dia (terça a domingo)', formatKz((asInt(rules['weeklyFee']) / 6).round())),
                row('Prazo', 'Segunda às ${rules['deliveryHour']}'),
                row('Atraso até 24 h', formatKz(asInt(rules['penaltyLate24']))),
                row('Atraso de 24 h a 72 h', formatKz(asInt(rules['penaltyLate72']))),
                row('Multa fora de horário', formatKz(asInt(rules['fineOffHours']))),
                row('Multa diária sem restituição', formatKz(asInt(rules['returnDelayDaily']))),
                row('Franquia máxima por sinistro', formatKz(asInt(rules['deductibleLimit']))),
                row('Dia parado a partir de', '${rules['minStopHours']} h'),
              ]),
            ),
            const SectionHeader('Regras do contrato'),
            const Card(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: Text(
                  '• A entrega de segunda paga a semana que terminou (segunda a domingo).\n'
                  '• Cobra-se por dias trabalhados; a segunda-feira não circula.\n'
                  '• O dia da entrega da viatura conta; o dia da devolução não conta.\n'
                  '• Ocorrências validadas descontam os dias parados.\n'
                  '• Atraso acima de 72 h gera alerta de possível resolução.\n'
                  '• Comprovativo enviado até 12 h depois do pagamento: conta a hora do pagamento.',
                ),
              ),
            ),
            if (history.length > 1) ...[
              const SectionHeader('Histórico'),
              for (final version in history)
                Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    title: Text('A partir de ${formatDay('${version['effective_from']}')}'),
                    subtitle: Text(version['created_by_name'] == null ? 'Valores iniciais' : 'Por ${version['created_by_name']}'),
                    trailing: Text(formatKz(asInt(version['weekly_fee']))),
                  ),
                ),
            ],
          ];
        },
      ),
    );
  }
}

class ContractFormScreen extends ConsumerStatefulWidget {
  const ContractFormScreen({super.key, required this.current});

  final Map<String, dynamic> current;

  @override
  ConsumerState<ContractFormScreen> createState() => _ContractFormScreenState();
}

class _ContractFormScreenState extends ConsumerState<ContractFormScreen> {
  late final _fields = {
    for (final key in ['weeklyFee', 'penaltyLate24', 'penaltyLate72', 'fineOffHours', 'returnDelayDaily', 'deductibleLimit'])
      key: TextEditingController(text: groupKz(asInt(widget.current[key]))),
  };
  late final _hour = TextEditingController(text: '${widget.current['deliveryHour'] ?? '12:00'}');
  DateTime _effectiveFrom = _nextMonday();
  bool _busy = false;

  static DateTime _nextMonday() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day).add(Duration(days: (8 - now.weekday) % 7 == 0 ? 7 : (8 - now.weekday) % 7));
  }

  static const _labels = {
    'weeklyFee': 'Entrega semanal',
    'penaltyLate24': 'Atraso até 24 h',
    'penaltyLate72': 'Atraso de 24 h a 72 h',
    'fineOffHours': 'Multa fora de horário',
    'returnDelayDaily': 'Multa diária sem restituição',
    'deductibleLimit': 'Franquia máxima por sinistro',
  };

  @override
  void dispose() {
    for (final controller in _fields.values) {
      controller.dispose();
    }
    _hour.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).post<Map<String, dynamic>>('/contract-rules', {
        'effectiveFrom': isoDay(_effectiveFrom),
        for (final entry in _fields.entries) entry.key: parseKz(entry.value.text),
        'deliveryHour': _hour.text.trim(),
        'minStopHours': widget.current['minStopHours'] ?? 4,
      });
      ref.invalidate(contractRulesProvider);
      ref.invalidate(contractHistoryProvider);
      if (!mounted) return;
      showMessage(context, 'Novos valores guardados (a partir de ${formatDay(isoDay(_effectiveFrom))}).');
      Navigator.of(context).pop();
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.fieldErrors.values.expand((e) => e).firstOrNull ?? error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Alterar valores')),
        body: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
          DateOnlyField(
            label: 'Válido a partir de',
            value: _effectiveFrom,
            firstDate: DateTime.now(),
            onChanged: (value) => setState(() => _effectiveFrom = value ?? _effectiveFrom),
          ),
          Text('As semanas que começam antes desta data mantêm os valores anteriores.', style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 16),
          for (final entry in _fields.entries) ...[
            KzField(controller: entry.value, label: _labels[entry.key]!, allowZero: entry.key != 'weeklyFee'),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: _hour,
            keyboardType: TextInputType.datetime,
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9:]')), LengthLimitingTextInputFormatter(5)],
            decoration: const InputDecoration(labelText: 'Hora limite de segunda (HH:MM)'),
          ),
          const SizedBox(height: 24),
          FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'A guardar…' : 'Guardar nova versão')),
        ]),
      );
}

/// Contas da equipa (só admin). Os motoristas recebem acesso pelo convite na ficha.
class UsersScreen extends ConsumerWidget {
  const UsersScreen({super.key});

  Future<void> _create(BuildContext context, WidgetRef ref) async {
    final name = TextEditingController();
    final email = TextEditingController();
    final password = TextEditingController();
    var role = 'gestor';
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Nova conta da equipa'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextField(controller: name, decoration: const InputDecoration(labelText: 'Nome')),
              const SizedBox(height: 8),
              TextField(controller: email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email')),
              const SizedBox(height: 8),
              TextField(controller: password, obscureText: true, decoration: const InputDecoration(labelText: 'Palavra-passe (mín. 10)')),
              const SizedBox(height: 8),
              SegmentedButton<String>(
                segments: const [ButtonSegment(value: 'gestor', label: Text('Gestor')), ButtonSegment(value: 'admin', label: Text('Admin'))],
                selected: {role},
                onSelectionChanged: (value) => setState(() => role = value.first),
              ),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Criar')),
          ],
        ),
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await ref.read(apiProvider).post<Map<String, dynamic>>('/users', {
        'name': name.text.trim(),
        'email': email.text.trim(),
        'role': role,
        'password': password.text,
      });
      ref.invalidate(usersProvider);
      if (context.mounted) showMessage(context, 'Conta criada. Partilhe a palavra-passe com a pessoa por um canal seguro.');
    } on ApiException catch (error) {
      if (context.mounted) showMessage(context, error.fieldErrors.values.expand((e) => e).firstOrNull ?? error.message);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(sessionProvider).user?.id;
    const roles = {'admin': 'Admin', 'gestor': 'Gestor', 'motorista': 'Motorista'};
    return Scaffold(
      appBar: AppBar(title: const Text('Utilizadores')),
      floatingActionButton: FloatingActionButton.extended(onPressed: () => _create(context, ref), icon: const Icon(Icons.person_add_alt), label: const Text('Nova conta')),
      body: CachedBody<List<Map<String, dynamic>>>(
        provider: usersProvider,
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
        builder: (context, rows) => [
          for (final user in rows)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: SwitchListTile(
                secondary: Avatar('${user['name']}'),
                title: Text('${user['name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text([
                  roles[user['role']] ?? '${user['role']}',
                  user['email'] ?? user['phone'] ?? '',
                  if (user['lastLoginAt'] != null) 'último acesso ${formatDateTime(DateTime.parse('${user['lastLoginAt']}'))}',
                ].where((part) => '$part'.isNotEmpty).join(' · ')),
                value: user['active'] == true,
                onChanged: user['id'] == me
                    ? null
                    : (value) async {
                        try {
                          await ref.read(apiProvider).patch<Map<String, dynamic>>('/users/${user['id']}', {'active': value});
                          ref.invalidate(usersProvider);
                        } on ApiException catch (error) {
                          if (context.mounted) showMessage(context, error.message);
                        }
                      },
              ),
            ),
        ],
      ),
    );
  }
}
