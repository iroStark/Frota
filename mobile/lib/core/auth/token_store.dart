import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Guarda o refresh token e o perfil no armazenamento seguro do sistema (Keychain/Keystore).
/// O access token (15 min) fica só em memória.
class TokenStore {
  TokenStore([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;
  String? accessToken;

  static const _refreshKey = 'refresh_token';
  static const _userKey = 'user';
  static const _biometricKey = 'biometric_lock';

  Future<String?> readRefreshToken() => _storage.read(key: _refreshKey);

  Future<Map<String, dynamic>?> readUser() async {
    final raw = await _storage.read(key: _userKey);
    return raw == null ? null : jsonDecode(raw) as Map<String, dynamic>;
  }

  Future<void> saveSession({required String accessToken, required String refreshToken, required Map<String, dynamic> user}) async {
    this.accessToken = accessToken;
    await _storage.write(key: _refreshKey, value: refreshToken);
    await _storage.write(key: _userKey, value: jsonEncode(user));
  }

  Future<bool> biometricLockEnabled() async => await _storage.read(key: _biometricKey) == 'true';

  Future<void> setBiometricLock(bool enabled) => _storage.write(key: _biometricKey, value: '$enabled');

  Future<void> clear() async {
    accessToken = null;
    await _storage.delete(key: _refreshKey);
    await _storage.delete(key: _userKey);
  }
}
