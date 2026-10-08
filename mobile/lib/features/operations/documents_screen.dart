import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/format/format.dart';
import '../../core/widgets/photo_field.dart';
import '../../core/widgets/widgets.dart';
import '../driver/driver_screens.dart' show validityChip;
import '../payments/common.dart';
import '../shared/providers.dart';

const documentTypes = {
  'bilhete_identidade': 'Bilhete de Identidade',
  'carta_conducao': 'Carta de condução',
  'livrete': 'Livrete',
  'titulo_propriedade': 'Título de propriedade',
  'seguro': 'Seguro',
  'inspecao': 'Inspeção',
  'imposto_circulacao': 'Imposto de circulação',
  'licenca_taxi': 'Licença de táxi',
  'contrato': 'Contrato',
  'outro': 'Outro',
};
const _driverTypes = ['bilhete_identidade', 'carta_conducao', 'contrato', 'outro'];
const _vehicleTypes = ['livrete', 'titulo_propriedade', 'seguro', 'inspecao', 'imposto_circulacao', 'licenca_taxi', 'outro'];

class DocumentsScreen extends ConsumerStatefulWidget {
  const DocumentsScreen({super.key});

  @override
  ConsumerState<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends ConsumerState<DocumentsScreen> {
  String _filter = 'tratar';

  @override
  Widget build(BuildContext context) {
    final vehicles = {for (final v in ref.watch(vehiclesProvider).value?.data ?? const <Map<String, dynamic>>[]) v['id']: v};
    final drivers = {for (final d in ref.watch(driversProvider).value?.data ?? const <Map<String, dynamic>>[]) d['id']: d};
    String owner(Map<String, dynamic> doc) => switch (doc['owner_type']) {
          'vehicle' => '${vehicles[doc['owner_id']]?['plate'] ?? 'Viatura'}',
          'driver' => '${drivers[doc['owner_id']]?['name'] ?? 'Motorista'}',
          _ => 'Empresa',
        };
    return Scaffold(
      appBar: AppBar(title: const Text('Documentos')),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('new_document'),
        onPressed: () => context.push('/documentos/novo'),
        icon: const Icon(Icons.add),
        label: const Text('Novo'),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: SegmentedButton<String>(
            segments: const [ButtonSegment(value: 'tratar', label: Text('A tratar')), ButtonSegment(value: 'todos', label: Text('Todos'))],
            selected: {_filter},
            onSelectionChanged: (value) => setState(() => _filter = value.first),
          ),
        ),
        Expanded(
          child: CachedBody<List<Map<String, dynamic>>>(
            provider: documentsProvider,
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 96),
            builder: (context, rows) {
              final visible = _filter == 'todos' ? rows : rows.where((d) => d['validity'] == 'expirado' || d['validity'] == 'a_expirar').toList();
              if (visible.isEmpty) return [const EmptyState('Nenhum documento expirado ou a expirar em 30 dias.', icon: Icons.verified_outlined)];
              return [
                for (final doc in visible)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      leading: doc['file_id'] == null
                          ? const Icon(Icons.description_outlined)
                          : ClipRRect(borderRadius: BorderRadius.circular(8), child: SizedBox(width: 44, height: 44, child: AuthImage(doc['file_id'] as String, height: 44))),
                      title: Text('${documentTypes[doc['type']] ?? doc['type']} · ${owner(doc)}', style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text([
                        if (doc['number'] != null) 'N.º ${doc['number']}',
                        if (doc['valid_until'] != null) 'Validade ${formatDay('${doc['valid_until']}')}',
                      ].join(' · ')),
                      trailing: validityChip(doc['validity'] as String?),
                    ),
                  ),
              ];
            },
          ),
        ),
      ]),
    );
  }
}

class DocumentFormScreen extends ConsumerStatefulWidget {
  const DocumentFormScreen({super.key, this.ownerType, this.ownerId});

  final String? ownerType;
  final String? ownerId;

  @override
  ConsumerState<DocumentFormScreen> createState() => _DocumentFormScreenState();
}

class _DocumentFormScreenState extends ConsumerState<DocumentFormScreen> {
  late String _ownerType = widget.ownerType ?? 'driver';
  late String? _ownerId = widget.ownerId;
  String _type = 'carta_conducao';
  final _number = TextEditingController();
  DateTime? _validUntil;
  XFile? _photo;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    if (_ownerType == 'vehicle') _type = 'seguro';
  }

  @override
  void dispose() {
    _number.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_ownerType != 'company' && _ownerId == null) {
      showMessage(context, _ownerType == 'vehicle' ? 'Escolha a viatura.' : 'Escolha o motorista.');
      return;
    }
    setState(() => _busy = true);
    final api = ref.read(apiProvider);
    try {
      final fileId = _photo == null ? null : await api.uploadFile(_photo!.path, category: 'documento-$_type');
      await api.post<Map<String, dynamic>>('/documents', {
        'ownerType': _ownerType,
        'ownerId': _ownerType == 'company' ? null : _ownerId,
        'type': _type,
        'number': _number.text.trim().isEmpty ? null : _number.text.trim(),
        'validUntil': _validUntil == null ? null : isoDay(_validUntil!),
        'fileId': fileId,
      });
      ref.invalidate(documentsProvider);
      ref.invalidate(dashboardProvider);
      if (_ownerType == 'vehicle' && _ownerId != null) ref.invalidate(vehicleDetailProvider(_ownerId!));
      if (_ownerType == 'driver' && _ownerId != null) ref.invalidate(driverDetailProvider(_ownerId!));
      if (!mounted) return;
      showMessage(context, 'Documento registado.');
      context.pop();
    } on ApiException catch (error) {
      if (mounted) showMessage(context, error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final vehicles = ref.watch(vehiclesProvider).value?.data ?? const [];
    final drivers = ref.watch(driversProvider).value?.data ?? const [];
    final types = switch (_ownerType) { 'vehicle' => _vehicleTypes, 'driver' => _driverTypes, _ => documentTypes.keys.toList() };
    return Scaffold(
      appBar: AppBar(title: const Text('Novo documento')),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
        if (widget.ownerId == null) ...[
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'driver', label: Text('Motorista')),
              ButtonSegment(value: 'vehicle', label: Text('Viatura')),
              ButtonSegment(value: 'company', label: Text('Empresa')),
            ],
            selected: {_ownerType},
            onSelectionChanged: (value) => setState(() {
              _ownerType = value.first;
              _ownerId = null;
              _type = _ownerType == 'vehicle' ? 'seguro' : _ownerType == 'driver' ? 'carta_conducao' : 'contrato';
            }),
          ),
          const SizedBox(height: 12),
          if (_ownerType != 'company')
            DropdownButtonFormField<String>(
              key: ValueKey(_ownerType),
              initialValue: _ownerId,
              isExpanded: true,
              decoration: InputDecoration(labelText: _ownerType == 'vehicle' ? 'Viatura' : 'Motorista'),
              items: _ownerType == 'vehicle'
                  ? [for (final v in vehicles) DropdownMenuItem(value: v['id'] as String, child: Text('${v['plate'] ?? '${v['brand']} ${v['model']}'}'))]
                  : [for (final d in drivers) DropdownMenuItem(value: d['id'] as String, child: Text('${d['name']}'))],
              onChanged: (value) => setState(() => _ownerId = value),
            ),
        ],
        const SizedBox(height: 12),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final type in types)
            ChoiceChip(label: Text(documentTypes[type]!), selected: _type == type, onSelected: (_) => setState(() => _type = type)),
        ]),
        const SizedBox(height: 16),
        PhotoField(label: 'Foto ou digitalização', value: _photo, onChanged: (file) => setState(() => _photo = file)),
        const SizedBox(height: 12),
        TextField(controller: _number, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Número / referência')),
        DateOnlyField(label: 'Válido até', value: _validUntil, allowClear: true, onChanged: (value) => setState(() => _validUntil = value)),
        Text('Com validade, aparece nos alertas 30 dias antes de expirar.', style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 24),
        FilledButton(key: const Key('save_document'), onPressed: _busy ? null : _submit, child: Text(_busy ? 'A guardar…' : 'Guardar documento')),
      ]),
    );
  }
}
