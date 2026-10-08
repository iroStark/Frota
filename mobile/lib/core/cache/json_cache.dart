import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../api/api_error.dart';

/// Resultado de uma leitura: da rede, ou da última cópia guardada quando não há ligação.
class Cached<T> {
  Cached(this.data, {required this.savedAt, required this.fromCache});

  final T data;
  final DateTime savedAt;
  final bool fromCache;
}

/// Cache simples em ficheiros JSON (um por chave) para a app abrir e mostrar dados sem rede.
/// A fila de escritas offline (Fase 6) usará uma base local própria.
class JsonCache {
  JsonCache({Future<Directory> Function()? directory}) : _directory = directory ?? getApplicationSupportDirectory;

  final Future<Directory> Function() _directory;

  Future<File> _file(String key) async {
    final dir = Directory('${(await _directory()).path}/cache');
    await dir.create(recursive: true);
    return File('${dir.path}/${key.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '_')}.json');
  }

  Future<void> write(String key, Object? data) async {
    final file = await _file(key);
    await file.writeAsString(jsonEncode({'savedAt': DateTime.now().toIso8601String(), 'data': data}));
  }

  Future<Cached<Object?>?> read(String key) async {
    final file = await _file(key);
    if (!await file.exists()) return null;
    final json = jsonDecode(await file.readAsString()) as Map<String, dynamic>;
    return Cached(json['data'], savedAt: DateTime.parse(json['savedAt'] as String), fromCache: true);
  }

  /// Rede primeiro; sem ligação devolve a última cópia (se existir).
  Future<Cached<T>> fetch<T>(String key, Future<T> Function() network) async {
    try {
      final data = await network();
      await write(key, data);
      return Cached(data, savedAt: DateTime.now(), fromCache: false);
    } on ApiException catch (error) {
      if (!error.isOffline) rethrow;
      final cached = await read(key);
      if (cached == null) rethrow;
      return Cached(cached.data as T, savedAt: cached.savedAt, fromCache: true);
    }
  }

  Future<void> clear() async {
    final dir = Directory('${(await _directory()).path}/cache');
    if (await dir.exists()) await dir.delete(recursive: true);
  }
}
