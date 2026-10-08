import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uhocha_frota/core/api/api_client.dart';
import 'package:uhocha_frota/core/api/api_error.dart';
import 'package:uhocha_frota/core/cache/json_cache.dart';

import 'fakes.dart';

const user = {'id': 'u1', 'name': 'Gestora', 'role': 'gestor', 'driverId': null};

void main() {
  late MemoryTokenStore tokens;

  setUp(() {
    tokens = MemoryTokenStore()
      ..accessToken = 'velho'
      ..refresh = 'refresh-1'
      ..user = Map.of(user);
  });

  ApiClient client(FakeAdapter adapter) => ApiClient(tokens, dio: Dio(BaseOptions(baseUrl: 'http://api'))..httpClientAdapter = adapter);

  test('401 renova a sessão uma única vez para pedidos em paralelo e repete-os', () async {
    var refreshes = 0;
    final adapter = FakeAdapter((options) {
      if (options.path == '/auth/refresh') {
        refreshes++;
        return jsonBody(200, {'accessToken': 'novo', 'refreshToken': 'refresh-2', 'user': user});
      }
      final auth = options.headers['Authorization'];
      return auth == 'Bearer novo' ? jsonBody(200, {'ok': options.path}) : jsonBody(401, {'error': 'expirada', 'code': 'nao_autenticado'});
    });
    final api = client(adapter);
    final results = await Future.wait([api.get<Map>('/a'), api.get<Map>('/b'), api.get<Map>('/c')]);
    expect(results.map((r) => r['ok']), ['/a', '/b', '/c']);
    expect(refreshes, 1);
    expect(tokens.refresh, 'refresh-2');
  });

  test('refresh recusado termina a sessão e propaga o 401', () async {
    var expired = false;
    final adapter = FakeAdapter((options) => jsonBody(401, {'error': 'Sessão expirada.', 'code': 'sessao_invalida'}));
    final api = client(adapter)..onSessionExpired = () => expired = true;
    await expectLater(api.get<Map>('/dashboard'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)));
    expect(expired, isTrue);
  });

  test('erros de validação trazem os campos', () async {
    final adapter = FakeAdapter((_) => jsonBody(422, {
          'error': 'Dados inválidos.',
          'code': 'validacao',
          'details': {'fieldErrors': {'amount': ['Too small']}},
        }));
    try {
      await client(adapter).post<Map>('/payments', {});
      fail('devia falhar');
    } on ApiException catch (error) {
      expect(error.code, 'validacao');
      expect(error.fieldErrors['amount'], ['Too small']);
    }
  });

  test('sem rede, a cache devolve a última cópia; com rede atualiza-a', () async {
    final dir = await Directory.systemTemp.createTemp('cache');
    final cache = JsonCache(directory: () async => dir);
    final fresh = await cache.fetch('k', () async => {'v': 1});
    expect(fresh.fromCache, isFalse);
    final offline = await cache.fetch<Map>('k', () async => throw ApiException('sem rede'));
    expect(offline.fromCache, isTrue);
    expect(offline.data['v'], 1);
    await expectLater(cache.fetch('outra', () async => throw ApiException('sem rede')), throwsA(isA<ApiException>()));
    await expectLater(cache.fetch('k', () async => throw ApiException('proibido', status: 403)), throwsA(isA<ApiException>()));
  });
}
