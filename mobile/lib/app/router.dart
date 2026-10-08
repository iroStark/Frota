import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/auth/session.dart';
import '../features/auth/auth_screens.dart';
import '../features/driver/driver_screens.dart';
import '../features/driver/send_proof_screen.dart';
import '../features/fleet/assign_screen.dart';
import '../features/fleet/driver_form_screen.dart';
import '../features/fleet/return_screen.dart';
import '../features/fleet/vehicle_detail_screen.dart';
import '../features/fleet/vehicle_form_screen.dart';
import '../features/operations/admin_screens.dart';
import '../features/operations/documents_screen.dart';
import '../features/operations/expenses_screen.dart';
import '../features/operations/incident_form_screen.dart';
import '../features/operations/incidents_screen.dart';
import '../features/reports/reports_screen.dart';
import '../features/shared/notifications_screen.dart';
import '../features/payments/group_payment_screen.dart';
import '../features/payments/receive_payment_screen.dart';
import '../features/payments/review_screen.dart';
import '../features/staff/driver_detail_screen.dart';
import '../features/shared/shells.dart';
import '../features/staff/staff_screens.dart';

/// Dados passados entre ecrãs (`extra`): vêm muitas vezes de JSON como `Map<dynamic, dynamic>`.
Map<String, dynamic>? _extraMap(GoRouterState state) {
  final extra = state.extra;
  return extra is Map ? Map<String, dynamic>.from(extra) : null;
}

/// Notifica o GoRouter quando a sessão muda, para reavaliar o redirecionamento.
class _SessionListenable extends ChangeNotifier {
  _SessionListenable(Ref ref) {
    ref.listen(sessionProvider, (_, _) => notifyListeners());
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  final listenable = _SessionListenable(ref);
  ref.onDispose(listenable.dispose);

  return GoRouter(
    initialLocation: '/',
    refreshListenable: listenable,
    redirect: (context, state) {
      final session = ref.read(sessionProvider);
      final path = state.matchedLocation;
      const publicPaths = ['/entrar', '/ativar'];
      switch (session.status) {
        case SessionStatus.loading:
          return path == '/' ? null : '/';
        case SessionStatus.signedOut:
          return publicPaths.contains(path) ? null : '/entrar';
        case SessionStatus.locked:
          return path == '/desbloquear' ? null : '/desbloquear';
        case SessionStatus.signedIn:
          final home = session.user!.isStaff ? '/inicio' : '/m/inicio';
          if (path == '/' || publicPaths.contains(path) || path == '/desbloquear') return home;
          final inDriverArea = path.startsWith('/m/');
          final inStaffArea = ['/inicio', '/cobrancas', '/frota', '/mais', '/alertas', '/pagamentos', '/validar', '/motoristas', '/viaturas', '/atribuir', '/devolver', '/ocorrencias', '/despesas', '/documentos', '/contrato', '/utilizadores', '/relatorios'].any(path.startsWith);
          if (session.user!.isStaff && inDriverArea) return home;
          if (!session.user!.isStaff && inStaffArea) return home;
          return null;
      }
    },
    routes: [
      GoRoute(path: '/', builder: (_, _) => const Scaffold(body: Center(child: CircularProgressIndicator()))),
      GoRoute(path: '/entrar', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/ativar', builder: (_, _) => const ActivateScreen()),
      GoRoute(path: '/desbloquear', builder: (_, _) => const UnlockScreen()),
      GoRoute(path: '/alertas', builder: (_, _) => const AlertsScreen()),
      GoRoute(path: '/validar', builder: (_, _) => const ReviewScreen()),
      GoRoute(path: '/pagamentos/receber', builder: (_, state) => ReceivePaymentScreen(driverId: state.uri.queryParameters['motorista'])),
      GoRoute(path: '/pagamentos/grupo', builder: (_, _) => const GroupPaymentScreen()),
      GoRoute(path: '/motoristas/novo', builder: (_, _) => const DriverFormScreen()),
      GoRoute(path: '/motoristas/:id', builder: (_, state) => DriverDetailScreen(driverId: state.pathParameters['id']!)),
      GoRoute(path: '/motoristas/:id/editar', builder: (_, state) => DriverFormScreen(driver: _extraMap(state))),
      GoRoute(path: '/viaturas/nova', builder: (_, _) => const VehicleFormScreen()),
      GoRoute(path: '/viaturas/:id', builder: (_, state) => VehicleDetailScreen(vehicleId: state.pathParameters['id']!)),
      GoRoute(path: '/viaturas/:id/editar', builder: (_, state) => VehicleFormScreen(vehicle: _extraMap(state))),
      GoRoute(
        path: '/atribuir',
        builder: (_, state) => AssignScreen(vehicleId: state.uri.queryParameters['viatura'], driverId: state.uri.queryParameters['motorista']),
      ),
      GoRoute(path: '/devolver', builder: (_, state) => ReturnScreen(assignment: _extraMap(state)!)),
      GoRoute(path: '/m/comprovativo', builder: (_, _) => const SendProofScreen()),
      GoRoute(path: '/m/ocorrencia', builder: (_, _) => const IncidentFormScreen()),
      GoRoute(path: '/ocorrencias', builder: (_, _) => const IncidentsScreen()),
      GoRoute(path: '/ocorrencias/nova', builder: (_, state) => IncidentFormScreen(vehicleId: state.uri.queryParameters['viatura'])),
      GoRoute(path: '/despesas', builder: (_, _) => const ExpensesScreen()),
      GoRoute(path: '/despesas/nova', builder: (_, _) => const ExpenseFormScreen()),
      GoRoute(path: '/documentos', builder: (_, _) => const DocumentsScreen()),
      GoRoute(
        path: '/documentos/novo',
        builder: (_, state) => DocumentFormScreen(ownerType: state.uri.queryParameters['dono'], ownerId: state.uri.queryParameters['id']),
      ),
      GoRoute(path: '/contrato', builder: (_, _) => const ContractScreen()),
      GoRoute(path: '/relatorios', builder: (_, _) => const ReportsScreen()),
      GoRoute(path: '/avisos', builder: (_, _) => const NotificationsScreen()),
      GoRoute(
        path: '/utilizadores',
        redirect: (_, _) => ref.read(sessionProvider).user?.role == Role.admin ? null : '/mais',
        builder: (_, _) => const UsersScreen(),
      ),
      GoRoute(path: '/em-breve', builder: (_, state) => ComingSoonScreen(title: state.uri.queryParameters['titulo'] ?? 'Em breve')),
      StatefulShellRoute.indexedStack(
        builder: (_, _, shell) => AppShell(shell: shell, isStaff: true),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/inicio', builder: (_, _) => const StaffHomeScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/cobrancas', builder: (_, _) => const ChargesScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/frota', builder: (_, _) => const FleetScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/mais', builder: (_, _) => const MoreScreen())]),
        ],
      ),
      StatefulShellRoute.indexedStack(
        builder: (_, _, shell) => AppShell(shell: shell, isStaff: false),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/m/inicio', builder: (_, _) => const DriverHomeScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/m/pagamentos', builder: (_, _) => const DriverPaymentsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/m/perfil', builder: (_, _) => const DriverProfileScreen())]),
        ],
      ),
    ],
  );
});
