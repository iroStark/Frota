import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/session.dart';
import '../../core/cache/json_cache.dart';
import 'models.dart';

/// Leitura com cache: rede primeiro, última cópia guardada se não houver ligação.
Future<Cached<T>> _cachedGet<T>(Ref ref, String key, String path, T Function(Object? json) parse) async {
  final api = ref.read(apiProvider);
  final raw = await ref.read(cacheProvider).fetch<Object?>(key, () => api.get<Object?>(path));
  return Cached(parse(raw.data), savedAt: raw.savedAt, fromCache: raw.fromCache);
}

Map<String, dynamic> _map(Object? json) => Map<String, dynamic>.from(json as Map);
List<Map<String, dynamic>> _rows(Object? json) => (json as List).map((row) => Map<String, dynamic>.from(row as Map)).toList();

// --- equipa -------------------------------------------------------------------------------------
final dashboardProvider = FutureProvider.autoDispose<Cached<Dashboard>>(
  (ref) => _cachedGet(ref, 'dashboard', '/dashboard', (json) => Dashboard.fromJson(_map(json))),
);

final vehiclesProvider = FutureProvider.autoDispose<Cached<List<Map<String, dynamic>>>>(
  (ref) => _cachedGet(ref, 'vehicles', '/vehicles', _rows),
);

final driversProvider = FutureProvider.autoDispose<Cached<List<Map<String, dynamic>>>>(
  (ref) => _cachedGet(ref, 'drivers', '/drivers', _rows),
);

// --- motorista ----------------------------------------------------------------------------------
final driverHomeProvider = FutureProvider.autoDispose<Cached<DriverHome>>(
  (ref) => _cachedGet(ref, 'me_home', '/me/home', (json) => DriverHome.fromJson(_map(json))),
);

final myStatementProvider = FutureProvider.autoDispose<Cached<Statement>>(
  (ref) => _cachedGet(ref, 'me_statement', '/me/statement', (json) => Statement.fromJson(_map(json))),
);

final myProfileProvider = FutureProvider.autoDispose<Cached<Map<String, dynamic>>>((ref) {
  final driverId = ref.watch(sessionProvider).user?.driverId;
  return _cachedGet(ref, 'me_profile', '/drivers/$driverId', _map);
});

final driverStatementProvider = FutureProvider.autoDispose.family<Cached<Statement>, String>(
  (ref, driverId) => _cachedGet(ref, 'statement_$driverId', '/drivers/$driverId/statement', (json) => Statement.fromJson(_map(json))),
);

final driverDetailProvider = FutureProvider.autoDispose.family<Cached<Map<String, dynamic>>, String>(
  (ref, driverId) => _cachedGet(ref, 'driver_$driverId', '/drivers/$driverId', _map),
);

final pendingDeclarationsProvider = FutureProvider.autoDispose<Cached<List<Map<String, dynamic>>>>(
  (ref) => _cachedGet(ref, 'declarations_pending', '/payment-declarations?status=pendente', _rows),
);

final incidentsToValidateProvider = FutureProvider.autoDispose<Cached<List<Map<String, dynamic>>>>(
  (ref) => _cachedGet(ref, 'incidents_to_validate', '/incidents?status=por_validar', _rows),
);

/// Depois de registar dinheiro: tudo o que mostra saldos fica desatualizado.
void invalidateMoney(WidgetRef ref, {String? driverId}) {
  ref.invalidate(dashboardProvider);
  ref.invalidate(driversProvider);
  ref.invalidate(pendingDeclarationsProvider);
  if (driverId != null) {
    ref.invalidate(driverStatementProvider(driverId));
    ref.invalidate(driverDetailProvider(driverId));
  }
}

final vehicleDetailProvider = FutureProvider.autoDispose.family<Cached<Map<String, dynamic>>, String>(
  (ref, vehicleId) => _cachedGet(ref, 'vehicle_$vehicleId', '/vehicles/$vehicleId', _map),
);

final contractRulesProvider = FutureProvider.autoDispose<Cached<Map<String, dynamic>>>(
  (ref) => _cachedGet(ref, 'contract_rules', '/contract-rules/current', _map),
);

/// Depois de mexer na frota (viaturas, motoristas, atribuições).
void invalidateFleet(WidgetRef ref, {String? vehicleId, String? driverId}) {
  ref.invalidate(vehiclesProvider);
  ref.invalidate(driversProvider);
  ref.invalidate(dashboardProvider);
  if (vehicleId != null) ref.invalidate(vehicleDetailProvider(vehicleId));
  if (driverId != null) {
    ref.invalidate(driverDetailProvider(driverId));
    ref.invalidate(driverStatementProvider(driverId));
  }
}

final incidentsProvider = FutureProvider.autoDispose.family<Cached<List<Map<String, dynamic>>>, String>(
  (ref, status) => _cachedGet(ref, 'incidents_$status', status == 'todas' ? '/incidents' : '/incidents?status=$status', _rows),
);

final myIncidentsProvider = FutureProvider.autoDispose<Cached<List<Map<String, dynamic>>>>(
  (ref) => _cachedGet(ref, 'me_incidents', '/me/incidents', _rows),
);

final expensesProvider = FutureProvider.autoDispose<Cached<List<Map<String, dynamic>>>>(
  (ref) => _cachedGet(ref, 'expenses', '/expenses', _rows),
);

final documentsProvider = FutureProvider.autoDispose<Cached<List<Map<String, dynamic>>>>(
  (ref) => _cachedGet(ref, 'documents', '/documents', _rows),
);

final contractHistoryProvider = FutureProvider.autoDispose<Cached<List<Map<String, dynamic>>>>(
  (ref) => _cachedGet(ref, 'contract_history', '/contract-rules', _rows),
);

final usersProvider = FutureProvider.autoDispose<Cached<List<Map<String, dynamic>>>>(
  (ref) => _cachedGet(ref, 'users', '/users', _rows),
);

void invalidateIncidents(WidgetRef ref) {
  for (final status in ['todas', 'por_validar', 'em_curso', 'agendada', 'resolvida', 'cancelada']) {
    ref.invalidate(incidentsProvider(status));
  }
  ref.invalidate(incidentsToValidateProvider);
  ref.invalidate(myIncidentsProvider);
  ref.invalidate(driverHomeProvider);
  ref.invalidate(dashboardProvider);
  ref.invalidate(vehiclesProvider);
}
