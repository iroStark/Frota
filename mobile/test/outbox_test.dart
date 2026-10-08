import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uhocha_frota/core/api/api_client.dart';
import 'package:uhocha_frota/core/auth/session.dart';
import 'package:uhocha_frota/core/offline/outbox.dart';

import 'fakes.dart';

class SwitchableAdapter implements HttpClientAdapter {
  bool online = false;
  int status = 201;
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<List<int>>? requestStream, Future<void>? cancelFuture) async {
    if (!online) throw DioException(requestOptions: options, type: DioExceptionType.connectionError);
    requests.add(options);
    return options.path == '/files'
        ? jsonBody(201, {'id': 'file-1'})
        : jsonBody(status, status < 300 ? {'ok': true} : {'error': 'Dados inválidos.', 'code': 'validacao'});
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  late Directory dir;
  late SwitchableAdapter adapter;
  late ProviderContainer container;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('outbox');
    adapter = SwitchableAdapter();
    final tokens = MemoryTokenStore()..accessToken = 't';
    container = ProviderContainer(overrides: [
      tokenStoreProvider.overrideWithValue(tokens),
      apiProvider.overrideWithValue(ApiClient(tokens, dio: Dio(BaseOptions(baseUrl: 'http://api'))..httpClientAdapter = adapter)),
      outboxStoreProvider.overrideWithValue(OutboxStore(directory: () async => dir)),
    ]);
    container.read(outboxProvider);
    await Future<void>.delayed(Duration.zero);
  });

  tearDown(() => container.dispose());

  Future<File> photo() async => File('${dir.path}/foto.jpg')..writeAsBytesSync([0xff, 0xd8, 0xff, 0x00]);

  test('sem rede fica em fila com cópia da foto; com rede é enviado e sai da fila', () async {
    final original = await photo();
    final outbox = container.read(outboxProvider.notifier);
    final result = await outbox.submit(
      path: '/payments',
      label: 'Pagamento',
      body: {'driverId': 'd1', 'amount': 1000, 'clientId': 'c1'},
      files: [OutboxFile(field: 'proofFileId', path: original.path, category: 'teste')],
    );
    expect(result, SubmitResult.queued);
    expect(container.read(outboxProvider), hasLength(1));
    final copy = container.read(outboxProvider).single.files.single.path;
    expect(copy, isNot(original.path));
    original.deleteSync(); // a foto original pode desaparecer (cache do sistema)
    expect(File(copy).existsSync(), isTrue);

    // Reabrir a app: a fila é lida do disco.
    expect(await OutboxStore(directory: () async => dir).load(), hasLength(1));

    adapter.online = true;
    await outbox.flush();
    expect(container.read(outboxProvider), isEmpty);
    expect(adapter.requests.map((r) => r.path), ['/files', '/payments']);
    expect((adapter.requests.last.data as Map)['proofFileId'], 'file-1');
    expect((adapter.requests.last.data as Map)['clientId'], 'c1');
    expect(File(copy).existsSync(), isFalse);
  });

  test('recusado pelo servidor fica marcado para o utilizador decidir', () async {
    final outbox = container.read(outboxProvider.notifier);
    await outbox.submit(path: '/expenses', label: 'Despesa', body: {'clientId': 'c2'});
    adapter
      ..online = true
      ..status = 422;
    await outbox.flush();
    expect(container.read(outboxProvider).single.error, 'Dados inválidos.');
    await outbox.discard(container.read(outboxProvider).single);
    expect(container.read(outboxProvider), isEmpty);
  });

  test('com rede envia logo e erros do servidor chegam ao ecrã', () async {
    adapter.online = true;
    final outbox = container.read(outboxProvider.notifier);
    expect(await outbox.submit(path: '/payments', label: 'x', body: {'clientId': 'c3'}), SubmitResult.sent);
    adapter.status = 422;
    expect(outbox.submit(path: '/payments', label: 'x', body: {'clientId': 'c4'}), throwsA(isA<Exception>()));
  });
}
