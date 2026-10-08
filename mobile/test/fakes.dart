import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:uhocha_frota/core/auth/token_store.dart';

/// TokenStore em memória (sem Keychain/Keystore).
class MemoryTokenStore extends TokenStore {
  String? refresh;
  Map<String, dynamic>? user;
  bool biometric = false;

  @override
  Future<String?> readRefreshToken() async => refresh;

  @override
  Future<Map<String, dynamic>?> readUser() async => user;

  @override
  Future<void> saveSession({required String accessToken, required String refreshToken, required Map<String, dynamic> user}) async {
    this.accessToken = accessToken;
    refresh = refreshToken;
    this.user = user;
  }

  @override
  Future<bool> biometricLockEnabled() async => biometric;

  @override
  Future<void> clear() async {
    accessToken = null;
    refresh = null;
    user = null;
  }
}

typedef Handler = ResponseBody Function(RequestOptions options);

/// Adaptador HTTP falso: cada pedido é respondido pelo handler e fica registado.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handler);

  final Handler handler;
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    await Future<void>.delayed(const Duration(milliseconds: 5));
    return handler(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody jsonBody(int status, Object body) => ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
    );
