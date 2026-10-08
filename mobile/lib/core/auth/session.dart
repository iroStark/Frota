import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';

import '../api/api_client.dart';
import '../api/api_error.dart';
import '../cache/json_cache.dart';
import 'token_store.dart';

enum Role { admin, gestor, motorista }

class AppUser {
  AppUser({required this.id, required this.name, required this.role, this.driverId});

  final String id;
  final String name;
  final Role role;
  final String? driverId;

  bool get isStaff => role != Role.motorista;
  String get firstName => name.trim().split(RegExp(r'\s+')).first;

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: json['id'] as String,
        name: json['name'] as String,
        role: Role.values.byName(json['role'] as String),
        driverId: json['driverId'] as String?,
      );
}

enum SessionStatus { loading, signedOut, locked, signedIn }

class SessionState {
  const SessionState(this.status, {this.user, this.offline = false});

  final SessionStatus status;
  final AppUser? user;
  /// Entrou sem conseguir falar com o servidor (mostra dados guardados).
  final bool offline;
}

final tokenStoreProvider = Provider((ref) => TokenStore());
final cacheProvider = Provider((ref) => JsonCache());
final apiProvider = Provider((ref) {
  final client = ApiClient(ref.watch(tokenStoreProvider));
  client.onSessionExpired = () => ref.read(sessionProvider.notifier).expire();
  return client;
});

final sessionProvider = NotifierProvider<SessionController, SessionState>(SessionController.new);

class SessionController extends Notifier<SessionState> {
  final _localAuth = LocalAuthentication();

  TokenStore get _tokens => ref.read(tokenStoreProvider);
  ApiClient get _api => ref.read(apiProvider);

  @override
  SessionState build() {
    Future.microtask(restore);
    return const SessionState(SessionStatus.loading);
  }

  /// No arranque: renova a sessão guardada. Sem rede (ou servidor lento), entra com o perfil
  /// guardado em modo leitura. Qualquer falha inesperada leva ao ecrã de entrada — nunca fica
  /// presa no carregamento.
  Future<void> restore() async {
    try {
      final savedUser = await _tokens.readUser();
      if (savedUser == null || await _tokens.readRefreshToken() == null) {
        state = const SessionState(SessionStatus.signedOut);
        return;
      }
      var offline = false;
      try {
        final valid = await _api.refreshSession().timeout(const Duration(seconds: 8));
        if (!valid) {
          await _tokens.clear();
          state = const SessionState(SessionStatus.signedOut);
          return;
        }
      } catch (_) {
        offline = true;
      }
      final user = AppUser.fromJson((await _tokens.readUser()) ?? savedUser);
      final locked = await _tokens.biometricLockEnabled();
      state = SessionState(locked ? SessionStatus.locked : SessionStatus.signedIn, user: user, offline: offline);
    } catch (_) {
      state = const SessionState(SessionStatus.signedOut);
    }
  }

  Future<void> login(String login, String password) async {
    final data = await _api.post<Map<String, dynamic>>('/auth/login', {'login': login.trim(), 'password': password});
    await _startSession(data);
  }

  Future<void> activate(String phone, String code, String pin) async {
    final data = await _api.post<Map<String, dynamic>>('/auth/activate', {'phone': phone, 'code': code, 'pin': pin});
    await _startSession(data);
  }

  Future<void> _startSession(Map<String, dynamic> data) async {
    final user = Map<String, dynamic>.from(data['user'] as Map);
    await _tokens.saveSession(accessToken: data['accessToken'] as String, refreshToken: data['refreshToken'] as String, user: user);
    state = SessionState(SessionStatus.signedIn, user: AppUser.fromJson(user));
  }

  Future<bool> unlock() async {
    try {
      final ok = await _localAuth.authenticate(localizedReason: 'Desbloquear a app UHOCHA');
      if (ok) state = SessionState(SessionStatus.signedIn, user: state.user, offline: state.offline);
      return ok;
    } catch (_) {
      return false;
    }
  }

  Future<bool> canUseBiometrics() async {
    try {
      return await _localAuth.isDeviceSupported() && await _localAuth.canCheckBiometrics;
    } catch (_) {
      return false;
    }
  }

  Future<void> setBiometricLock(bool enabled) => _tokens.setBiometricLock(enabled);

  Future<void> logout() async {
    final refreshToken = await _tokens.readRefreshToken();
    if (refreshToken != null) {
      try {
        await _api.post<void>('/auth/logout', {'refreshToken': refreshToken});
      } on ApiException {
        // sair localmente mesmo sem rede
      }
    }
    await _signOutLocally();
  }

  /// O servidor recusou a renovação (sessão terminada noutro lado ou conta desativada).
  void expire() => _signOutLocally();

  Future<void> _signOutLocally() async {
    await _tokens.clear();
    await ref.read(cacheProvider).clear();
    state = const SessionState(SessionStatus.signedOut);
  }
}
