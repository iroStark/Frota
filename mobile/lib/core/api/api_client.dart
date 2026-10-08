import 'dart:async';

import 'package:dio/dio.dart';

import '../../app/env.dart';
import '../auth/token_store.dart';
import 'api_error.dart';

/// Cliente HTTP da API v1. Junta o Bearer token e, ao receber 401, renova a sessão uma única vez
/// (pedidos em paralelo esperam pela mesma renovação) e repete o pedido.
class ApiClient {
  ApiClient(this.tokens, {Dio? dio, this.onSessionExpired})
      : dio = dio ?? Dio(BaseOptions(baseUrl: Env.apiBase, connectTimeout: const Duration(seconds: 10), receiveTimeout: const Duration(seconds: 20))) {
    this.dio.interceptors.add(InterceptorsWrapper(onRequest: _attachToken, onError: _onError));
  }

  final TokenStore tokens;
  final Dio dio;
  void Function()? onSessionExpired;
  Future<bool>? _refreshing;

  static const _noAuthPaths = ['/auth/login', '/auth/refresh', '/auth/activate', '/auth/logout'];

  void _attachToken(RequestOptions options, RequestInterceptorHandler handler) {
    final token = tokens.accessToken;
    if (token != null && !_noAuthPaths.contains(options.path)) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  Future<void> _onError(DioException error, ErrorInterceptorHandler handler) async {
    final options = error.requestOptions;
    final retried = options.extra['retried'] == true;
    if (error.response?.statusCode != 401 || _noAuthPaths.contains(options.path) || retried) {
      handler.next(error);
      return;
    }
    final refreshed = await refreshSession();
    if (!refreshed) {
      onSessionExpired?.call();
      handler.next(error);
      return;
    }
    try {
      options.extra['retried'] = true;
      options.headers['Authorization'] = 'Bearer ${tokens.accessToken}';
      handler.resolve(await dio.fetch(options));
    } on DioException catch (retryError) {
      handler.next(retryError);
    }
  }

  /// Troca o refresh token por um novo par. Devolve false se a sessão já não for válida.
  Future<bool> refreshSession() {
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  Future<bool> _doRefresh() async {
    final refreshToken = await tokens.readRefreshToken();
    if (refreshToken == null) return false;
    try {
      final response = await dio.post<Map<String, dynamic>>('/auth/refresh', data: {'refreshToken': refreshToken});
      final data = response.data!;
      await tokens.saveSession(
        accessToken: data['accessToken'] as String,
        refreshToken: data['refreshToken'] as String,
        user: Map<String, dynamic>.from(data['user'] as Map),
      );
      return true;
    } on DioException catch (error) {
      if (error.response?.statusCode == 401) return false;
      rethrow; // sem rede: quem chamou decide (ex.: entrar em modo offline)
    }
  }

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) => _call(() => dio.get<T>(path, queryParameters: query));

  Future<T> post<T>(String path, [Object? body]) => _call(() => dio.post<T>(path, data: body));

  Future<T> patch<T>(String path, [Object? body]) => _call(() => dio.patch<T>(path, data: body));

  Future<T> delete<T>(String path) => _call(() => dio.delete<T>(path));

  /// Envia um ficheiro (foto/PDF) e devolve o id em `/files`.
  Future<String> uploadFile(String filePath, {String category = 'documento', String? fileName}) async {
    final name = fileName ?? filePath.split('/').last;
    final form = FormData.fromMap({
      'category': category,
      'file': await MultipartFile.fromFile(filePath, filename: name, contentType: _mediaType(name)),
    });
    final data = await _call(() => dio.post<Map<String, dynamic>>('/files', data: form));
    return data['id'] as String;
  }

  static DioMediaType _mediaType(String name) {
    final ext = name.split('.').last.toLowerCase();
    return switch (ext) {
      'pdf' => DioMediaType('application', 'pdf'),
      'png' => DioMediaType('image', 'png'),
      'webp' => DioMediaType('image', 'webp'),
      'heic' => DioMediaType('image', 'heic'),
      _ => DioMediaType('image', 'jpeg'),
    };
  }

  /// URL de um ficheiro protegido (usar com [authHeaders]).
  String fileUrl(String fileId) => '${dio.options.baseUrl}/files/$fileId';

  Map<String, String> get authHeaders => {if (tokens.accessToken != null) 'Authorization': 'Bearer ${tokens.accessToken}'};

  Future<T> _call<T>(Future<Response<T>> Function() request) async {
    try {
      return (await request()).data as T;
    } on DioException catch (error) {
      throw ApiException.fromDio(error);
    }
  }
}
