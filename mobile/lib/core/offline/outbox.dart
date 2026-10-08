import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import '../api/api_client.dart';
import '../api/api_error.dart';
import '../auth/session.dart';

/// Ficheiro a enviar antes do pedido; o id devolvido vai para `body[field]`.
class OutboxFile {
  OutboxFile({required this.field, required this.path, required this.category});

  factory OutboxFile.fromJson(Map<String, dynamic> json) =>
      OutboxFile(field: json['field'] as String, path: json['path'] as String, category: json['category'] as String);

  final String field;
  final String path;
  final String category;

  Map<String, dynamic> toJson() => {'field': field, 'path': path, 'category': category};
}

/// Um pedido por enviar. O corpo leva sempre um `clientId`: repetir o envio nunca duplica no servidor.
class OutboxEntry {
  OutboxEntry({
    required this.id,
    required this.path,
    required this.body,
    required this.label,
    required this.createdAt,
    this.files = const [],
    this.attempts = 0,
    this.error,
  });

  factory OutboxEntry.fromJson(Map<String, dynamic> json) => OutboxEntry(
        id: json['id'] as String,
        path: json['path'] as String,
        body: Map<String, dynamic>.from(json['body'] as Map),
        label: json['label'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
        files: (json['files'] as List).map((file) => OutboxFile.fromJson(Map<String, dynamic>.from(file as Map))).toList(),
        attempts: json['attempts'] as int? ?? 0,
        error: json['error'] as String?,
      );

  final String id;
  final String path;
  final Map<String, dynamic> body;
  final String label;
  final DateTime createdAt;
  final List<OutboxFile> files;
  final int attempts;
  /// Recusado pelo servidor (não é falta de rede): precisa de decisão do utilizador.
  final String? error;

  OutboxEntry copyWith({int? attempts, String? error, bool clearError = false}) => OutboxEntry(
        id: id, path: path, body: body, label: label, createdAt: createdAt, files: files,
        attempts: attempts ?? this.attempts, error: clearError ? null : error ?? this.error,
      );

  Map<String, dynamic> toJson() => {
        'id': id, 'path': path, 'body': body, 'label': label, 'createdAt': createdAt.toIso8601String(),
        'files': files.map((file) => file.toJson()).toList(), 'attempts': attempts, 'error': error,
      };
}

/// Armazenamento da fila num ficheiro JSON (sobrevive a fechar a app).
class OutboxStore {
  OutboxStore({Future<Directory> Function()? directory}) : _directory = directory ?? getApplicationSupportDirectory;

  final Future<Directory> Function() _directory;

  Future<Directory> filesDir() async {
    final dir = Directory('${(await _directory()).path}/outbox_files');
    await dir.create(recursive: true);
    return dir;
  }

  Future<File> _file() async => File('${(await _directory()).path}/outbox.json');

  Future<List<OutboxEntry>> load() async {
    final file = await _file();
    if (!await file.exists()) return [];
    final raw = jsonDecode(await file.readAsString()) as List;
    return raw.map((entry) => OutboxEntry.fromJson(Map<String, dynamic>.from(entry as Map))).toList();
  }

  Future<void> save(List<OutboxEntry> entries) async {
    final file = await _file();
    await file.writeAsString(jsonEncode(entries.map((entry) => entry.toJson()).toList()));
  }
}

enum SubmitResult { sent, queued }

final outboxStoreProvider = Provider((ref) => OutboxStore());
final outboxProvider = NotifierProvider<OutboxController, List<OutboxEntry>>(OutboxController.new);

class OutboxController extends Notifier<List<OutboxEntry>> {
  Timer? _timer;
  bool _flushing = false;

  OutboxStore get _store => ref.read(outboxStoreProvider);
  ApiClient get _api => ref.read(apiProvider);

  @override
  List<OutboxEntry> build() {
    ref.onDispose(() => _timer?.cancel());
    Future.microtask(() async {
      state = await _store.load();
      _schedule();
    });
    return const [];
  }

  /// Tenta enviar já; sem rede, guarda na fila (com cópia das fotos) e devolve [SubmitResult.queued].
  /// Erros do servidor (validação, permissões) são lançados como de costume.
  Future<SubmitResult> submit({required String path, required Map<String, dynamic> body, required String label, List<OutboxFile> files = const []}) async {
    assert(body.containsKey('clientId') || body['items'] is List, 'Pedidos em fila precisam de clientId para não duplicar.');
    try {
      await _send(path, body, files);
      return SubmitResult.sent;
    } on ApiException catch (error) {
      if (!error.isOffline) rethrow;
      final dir = await _store.filesDir();
      final copies = <OutboxFile>[];
      for (final file in files) {
        final target = '${dir.path}/${const Uuid().v4()}-${file.path.split('/').last}';
        await File(file.path).copy(target);
        copies.add(OutboxFile(field: file.field, path: target, category: file.category));
      }
      final entry = OutboxEntry(id: const Uuid().v4(), path: path, body: body, label: label, createdAt: DateTime.now(), files: copies);
      state = [...state, entry];
      await _store.save(state);
      _schedule();
      return SubmitResult.queued;
    }
  }

  Future<void> _send(String path, Map<String, dynamic> body, List<OutboxFile> files) async {
    final payload = Map<String, dynamic>.from(body);
    for (final file in files) {
      payload[file.field] = await _api.uploadFile(file.path, category: file.category);
    }
    await _api.post<Object?>(path, payload);
  }

  /// Envia o que está em fila, por ordem. Pára ao primeiro sinal de falta de rede.
  Future<void> flush() async {
    if (_flushing || state.isEmpty) return;
    _flushing = true;
    try {
      for (final entry in [...state]) {
        if (entry.error != null) continue;
        try {
          await _send(entry.path, entry.body, entry.files);
          await _remove(entry);
        } on ApiException catch (error) {
          if (error.isOffline) break;
          state = [for (final e in state) e.id == entry.id ? e.copyWith(attempts: e.attempts + 1, error: error.message) : e];
          await _store.save(state);
        }
      }
    } finally {
      _flushing = false;
      _schedule();
    }
  }

  Future<void> retry(OutboxEntry entry) async {
    state = [for (final e in state) e.id == entry.id ? e.copyWith(clearError: true) : e];
    await _store.save(state);
    await flush();
  }

  Future<void> discard(OutboxEntry entry) => _remove(entry);

  /// Ao sair da conta: nada pode ser enviado depois com a sessão de outra pessoa.
  Future<void> clearAll() async {
    for (final entry in [...state]) {
      await _remove(entry);
    }
    _timer?.cancel();
  }

  Future<void> _remove(OutboxEntry entry) async {
    for (final file in entry.files) {
      final local = File(file.path);
      if (await local.exists()) await local.delete();
    }
    state = state.where((e) => e.id != entry.id).toList();
    await _store.save(state);
  }

  /// Enquanto houver pendentes, tenta de 30 em 30 segundos.
  void _schedule() {
    _timer?.cancel();
    if (state.any((entry) => entry.error == null)) {
      _timer = Timer(const Duration(seconds: 30), flush);
    }
  }
}
