import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/auth/session.dart';
import '../features/auth/auth_screens.dart';
import '../features/driver/driver_screens.dart';
import '../features/driver/send_proof_screen.dart';
import '../features/payments/group_payment_screen.dart';
import '../features/payments/receive_payment_screen.dart';
import '../features/payments/review_screen.dart';
import '../features/staff/driver_detail_screen.dart';
import '../features/shared/shells.dart';
import '../features/staff/staff_screens.dart';

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
          final inStaffArea = ['/inicio', '/cobrancas', '/frota', '/mais', '/alertas', '/pagamentos', '/validar', '/motoristas'].any(path.startsWith);
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
      GoRoute(path: '/motoristas/:id', builder: (_, state) => DriverDetailScreen(driverId: state.pathParameters['id']!)),
      GoRoute(path: '/m/comprovativo', builder: (_, _) => const SendProofScreen()),
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
