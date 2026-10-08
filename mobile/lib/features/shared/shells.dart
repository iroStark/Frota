import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/auth/session.dart';
import '../../core/widgets/widgets.dart';
import '../driver/driver_screens.dart' show SettingsSection;

class _Action {
  const _Action(this.icon, this.label, this.route);

  final IconData icon;
  final String label;
  final String route;
}

const _staffActions = [
  _Action(Icons.payments_outlined, 'Receber pagamento', '/pagamentos/receber'),
  _Action(Icons.groups_outlined, 'Entrega em grupo', '/pagamentos/grupo'),
  _Action(Icons.receipt_outlined, 'Nova despesa', '/despesas/nova'),
  _Action(Icons.report_outlined, 'Nova ocorrência', '/ocorrencias/nova'),
  _Action(Icons.key_outlined, 'Atribuir viatura', '/atribuir'),
  _Action(Icons.upload_file_outlined, 'Novo documento', '/documentos/novo'),
];

const _driverActions = [
  _Action(Icons.receipt_long_outlined, 'Enviar comprovativo', '/m/comprovativo'),
  _Action(Icons.car_crash_outlined, 'Comunicar ocorrência', '/m/ocorrencia'),
];

void _openQuickActions(BuildContext context, List<_Action> actions) {
  showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        for (final action in actions)
          ListTile(
            leading: CircleAvatar(backgroundColor: Brand.lime, foregroundColor: Brand.graphite, child: Icon(action.icon)),
            title: Text(action.label, style: const TextStyle(fontWeight: FontWeight.w600)),
            onTap: () {
              Navigator.pop(sheetContext);
              context.push(action.route);
            },
          ),
        const SizedBox(height: 8),
      ]),
    ),
  );
}

/// Barra inferior com um botão central de ação rápida (não é um separador).
/// `isStaff` vem da rota (não da sessão): durante a troca de conta a casca antiga ainda pode
/// estar montada com o perfil novo, e os separadores têm de corresponder aos seus ramos.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.shell, required this.isStaff});

  final StatefulNavigationShell shell;
  final bool isStaff;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tabs = isStaff
        ? const [
            NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Início'),
            NavigationDestination(icon: Icon(Icons.payments_outlined), selectedIcon: Icon(Icons.payments), label: 'Cobranças'),
            NavigationDestination(icon: Icon(Icons.add_circle, size: 36), label: 'Registar'),
            NavigationDestination(icon: Icon(Icons.local_taxi_outlined), selectedIcon: Icon(Icons.local_taxi), label: 'Frota'),
            NavigationDestination(icon: Icon(Icons.menu), label: 'Mais'),
          ]
        : const [
            NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Início'),
            NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long), label: 'Pagamentos'),
            NavigationDestination(icon: Icon(Icons.add_circle, size: 36), label: 'Enviar'),
            NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Perfil'),
          ];
    const actionIndex = 2;
    final selected = shell.currentIndex >= actionIndex ? shell.currentIndex + 1 : shell.currentIndex;
    final offline = ref.watch(sessionProvider).offline;
    return Scaffold(
      body: Column(children: [
        if (offline)
          MaterialBanner(
            content: const Text('Entrou sem ligação. Os dados podem estar desatualizados.'),
            leading: const Icon(Icons.cloud_off),
            actions: [TextButton(onPressed: () => ref.read(sessionProvider.notifier).restore(), child: const Text('Repetir'))],
          ),
        Expanded(child: shell),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: selected,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        destinations: tabs,
        onDestinationSelected: (index) {
          if (index == actionIndex) {
            _openQuickActions(context, isStaff ? _staffActions : _driverActions);
            return;
          }
          final branch = index > actionIndex ? index - 1 : index;
          shell.goBranch(branch, initialLocation: branch == shell.currentIndex);
        },
      ),
    );
  }
}

class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionProvider).user;
    const roleLabels = {Role.admin: 'Administrador', Role.gestor: 'Gestor', Role.motorista: 'Motorista'};
    final items = [
      (Icons.bar_chart_outlined, 'Relatórios', '/em-breve?titulo=Relatórios'),
      (Icons.report_outlined, 'Ocorrências', '/ocorrencias'),
      (Icons.receipt_outlined, 'Despesas', '/despesas'),
      (Icons.folder_outlined, 'Documentos', '/documentos'),
      (Icons.gavel_outlined, 'Contrato e valores', '/contrato'),
      if (user?.role == Role.admin) (Icons.group_outlined, 'Utilizadores', '/utilizadores'),
    ];
    return Scaffold(
      appBar: AppBar(title: const Text('Mais')),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
        Card(
          child: ListTile(
            leading: Avatar(user?.name ?? '?', radius: 24),
            title: Text(user?.name ?? '', style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text(roleLabels[user?.role] ?? ''),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Column(children: [
            for (final (icon, label, route) in items)
              ListTile(
                leading: Icon(icon),
                title: Text(label),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(route),
              ),
          ]),
        ),
        const SizedBox(height: 12),
        const SettingsSection(),
      ]),
    );
  }
}

class ComingSoonScreen extends StatelessWidget {
  const ComingSoonScreen({super.key, required this.title});

  final String title;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(title)),
        body: const EmptyState('Este ecrã chega na próxima fase da app.', icon: Icons.construction_outlined),
      );
}
