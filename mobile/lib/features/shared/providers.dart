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
