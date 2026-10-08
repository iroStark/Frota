import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/auth/session.dart';
import '../../core/offline/outbox.dart';
import '../../core/format/format.dart';
import '../../core/widgets/widgets.dart';
import '../shared/models.dart';
import '../shared/providers.dart';
import '../payments/review_screen.dart' show incidentTypeLabels;
import '../shared/notifications_screen.dart';
import '../shared/statement_view.dart';

const _documentLabels = {
  'bilhete_identidade': 'Bilhete de Identidade',
  'carta_conducao': 'Carta de condução',
  'livrete': 'Livrete',
  'titulo_propriedade': 'Título de propriedade',
  'seguro': 'Seguro',
  'inspecao': 'Inspeção',
  'imposto_circulacao': 'Imposto de circulação',
  'licenca_taxi': 'Licença de táxi',
  'contrato': 'Contrato',
  'outro': 'Documento',
};

Widget validityChip(String? validity) => switch (validity) {
      'expirado' => const StatusChip('Expirado', tone: Tone.danger),
      'a_expirar' => const StatusChip('A expirar', tone: Tone.warn),
      'valido' => const StatusChip('Válido', tone: Tone.ok),
      _ => const StatusChip('Sem validade'),
    };

class DriverHomeScreen extends ConsumerWidget {
  const DriverHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionProvider).user;
    return Scaffold(
      appBar: AppBar(title: Text('${greeting()}, ${user?.firstName ?? ''}'), actions: const [NotificationsBell()]),
      body: CachedBody<DriverHome>(
        provider: driverHomeProvider,
        builder: (context, home) {
          final theme = Theme.of(context);
          final inDebt = home.overdue > 0;
          final expiring = home.documents.where((doc) => doc['validity'] == 'expirado' || doc['validity'] == 'a_expirar').toList();
          return [
            Card(
              color: inDebt ? Brand.danger : Brand.lime,
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(inDebt ? 'EM ATRASO' : home.balance > 0 ? 'SALDO A PAGAR' : 'ESTÁ EM DIA',
                      style: theme.textTheme.labelSmall?.copyWith(color: inDebt ? Colors.white70 : Brand.graphite.withValues(alpha: 0.7), letterSpacing: 0.6)),
                  const SizedBox(height: 6),
                  Text(formatKz(inDebt ? home.overdue : home.balance.clamp(0, 1 << 31)),
                      style: theme.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800, color: inDebt ? Colors.white : Brand.graphite)),
                  if (home.balance < 0)
                    Text('Tem ${formatKz(-home.balance)} de crédito.', style: const TextStyle(color: Brand.graphite)),
                  if (inDebt)
                    const Text('Regularize para evitar penalidades. Atrasos acima de 72h são comunicados à gestão.', style: TextStyle(color: Colors.white)),
                ]),
              ),
            ),
            if (home.nextDue != null) ...[
              const SizedBox(height: 12),
              Card(
                child: ListTile(
                  leading: const Icon(Icons.event_outlined),
                  title: Text('Próxima entrega: ${formatKz(home.nextDue!.estimatedAmount)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text(
                    'Semana ${formatWeek(home.nextDue!.periodStart)} · ${home.nextDue!.chargedDays} dia(s)'
                    '${home.nextDue!.stoppedDays > 0 ? ' · ${home.nextDue!.stoppedDays} parado(s)' : ''}\n'
                    'Até ${formatDateTime(home.nextDue!.dueAt)} (${formatCountdown(home.nextDue!.dueAt)})',
                  ),
                  isThreeLine: true,
                ),
              ),
            ],
            const SizedBox(height: 12),
            Card(
              child: ListTile(
                leading: const CircleAvatar(child: Icon(Icons.local_taxi)),
                title: Text(home.vehicle == null ? 'Sem viatura atribuída' : '${home.vehicle!['brand']} ${home.vehicle!['model']}',
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: home.vehicle == null ? null : Text('${home.vehicle!['plate'] ?? 'Sem matrícula'} · desde ${formatDate(DateTime.parse('${home.vehicle!['since']}'))}'),
              ),
            ),
            if (expiring.isNotEmpty) ...[
              const SectionHeader('Documentos a tratar'),
              ...expiring.map((doc) => Card(
                    child: ListTile(
                      leading: const Icon(Icons.description_outlined),
                      title: Text(_documentLabels[doc['type']] ?? '${doc['type']}'),
                      subtitle: Text('Validade ${formatDay('${doc['valid_until']}')}'),
                      trailing: validityChip(doc['validity'] as String?),
                    ),
                  )),
            ],
            if (home.openIncidents.isNotEmpty) ...[
              const SectionHeader('Ocorrências comunicadas'),
              ...home.openIncidents.map((incident) {
                final status = incident['status'] as String;
                return Card(
                  child: ListTile(
                    leading: const Icon(Icons.report_outlined),
                    title: Text(incidentTypeLabels[incident['type']] ?? '${incident['type']}'),
                    subtitle: Text('Desde ${formatDateTime(DateTime.parse('${incident['start_at']}'))}'),
                    trailing: StatusChip(
                      status == 'por_validar' ? 'À espera da gestão' : status == 'em_curso' ? 'Validada' : 'Agendada',
                      tone: status == 'por_validar' ? Tone.warn : Tone.ok,
                    ),
                  ),
                );
              }),
            ],
            if (home.declarations.isNotEmpty) ...[
              const SectionHeader('Comprovativos enviados'),
              ...home.declarations.map((declaration) {
                final status = declaration['status'] as String;
                return Card(
                  child: ListTile(
                    leading: const Icon(Icons.receipt_long_outlined),
                    title: Text(formatKz(asInt(declaration['amount']))),
                    subtitle: Text(status == 'rejeitada'
                        ? 'Rejeitado: ${declaration['rejection_reason'] ?? ''}'
                        : 'Enviado ${formatDateTime(DateTime.parse('${declaration['submitted_at']}'))}'),
                    trailing: StatusChip(
                      const {'pendente': 'Por confirmar', 'confirmada': 'Confirmado', 'rejeitada': 'Rejeitado'}[status] ?? status,
                      tone: status == 'confirmada' ? Tone.ok : status == 'rejeitada' ? Tone.danger : Tone.warn,
                    ),
                  ),
                );
              }),
            ],
          ];
        },
      ),
    );
  }
}

class DriverPaymentsScreen extends ConsumerWidget {
  const DriverPaymentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        appBar: AppBar(title: const Text('Pagamentos')),
        body: CachedBody<Statement>(
          provider: myStatementProvider,
          builder: (context, statement) => statementWidgets(context, statement, driverName: ref.watch(sessionProvider).user?.name),
        ),
      );
}

class DriverProfileScreen extends ConsumerWidget {
  const DriverProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        appBar: AppBar(title: const Text('Perfil')),
        body: CachedBody<Map<String, dynamic>>(
          provider: myProfileProvider,
          builder: (context, driver) {
            final documents = (driver['documents'] as List? ?? const []).cast<Map>();
            final contacts = (driver['contacts'] as List? ?? const []).cast<Map>();
            return [
              Card(
                child: ListTile(
                  leading: Avatar('${driver['name']}', radius: 24),
                  title: Text('${driver['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${driver['phone'] ?? ''}'),
                ),
              ),
              const SectionHeader('Documentos'),
              if (documents.isEmpty) const EmptyState('Sem documentos registados.'),
              ...documents.map((doc) => Card(
                    child: ListTile(
                      leading: const Icon(Icons.description_outlined),
                      title: Text(_documentLabels[doc['type']] ?? '${doc['type']}'),
                      subtitle: Text(doc['valid_until'] != null ? 'Validade ${formatDay('${doc['valid_until']}')}' : '${doc['number'] ?? ''}'),
                      trailing: validityChip(doc['validity'] as String?),
                    ),
                  )),
              if (contacts.isNotEmpty) ...[
                const SectionHeader('Contactos de emergência'),
                ...contacts.map((contact) => Card(
                      child: ListTile(
                        leading: const Icon(Icons.contact_phone_outlined),
                        title: Text('${contact['name']}'),
                        subtitle: Text([contact['relation'], contact['phone']].whereType<String>().join(' · ')),
                      ),
                    )),
              ],
              const SizedBox(height: 16),
              const SettingsSection(),
            ];
          },
        ),
      );
}

/// Bloqueio biométrico e sair — usado no Perfil (motorista) e em Mais (equipa).
class SettingsSection extends ConsumerStatefulWidget {
  const SettingsSection({super.key});

  @override
  ConsumerState<SettingsSection> createState() => _SettingsSectionState();
}

class _SettingsSectionState extends ConsumerState<SettingsSection> {
  bool? _biometric;
  bool _available = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final session = ref.read(sessionProvider.notifier);
    final available = await session.canUseBiometrics();
    final enabled = await ref.read(tokenStoreProvider).biometricLockEnabled();
    if (!mounted) return;
    setState(() {
      _available = available;
      _biometric = enabled;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Column(children: [
        if (_available)
          SwitchListTile(
            secondary: const Icon(Icons.fingerprint),
            title: const Text('Bloquear com biometria'),
            subtitle: const Text('Pede o rosto ou a impressão digital ao abrir a app.'),
            value: _biometric ?? false,
            onChanged: (value) async {
              await ref.read(sessionProvider.notifier).setBiometricLock(value);
              setState(() => _biometric = value);
            },
          ),
        ListTile(
          leading: const Icon(Icons.logout, color: Brand.danger),
          title: const Text('Sair', style: TextStyle(color: Brand.danger, fontWeight: FontWeight.w600)),
          onTap: () async {
            final ok = await showDialog<bool>(
              context: context,
              builder: (context) => AlertDialog(
                title: const Text('Sair da conta?'),
                content: Text(ref.read(outboxProvider).isEmpty
                    ? 'Os dados guardados neste telemóvel são apagados.'
                    : 'Há ${ref.read(outboxProvider).length} registo(s) por enviar (sem rede). Se sair, perdem-se.'),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
                  FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sair')),
                ],
              ),
            );
            if (ok == true) await ref.read(sessionProvider.notifier).logout();
          },
        ),
      ]),
    );
  }
}
