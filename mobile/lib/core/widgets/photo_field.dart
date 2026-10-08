import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../auth/session.dart';

/// Escolher foto (câmara ou galeria) com pré-visualização. As fotos são reduzidas antes de enviar
/// (redes móveis lentas): lado maior 1600 px, qualidade 80.
class PhotoField extends StatelessWidget {
  const PhotoField({super.key, required this.label, required this.value, required this.onChanged, this.required = false});

  final String label;
  final XFile? value;
  final ValueChanged<XFile?> onChanged;
  final bool required;

  Future<void> _pick(BuildContext context) async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Tirar foto'), onTap: () => Navigator.pop(context, ImageSource.camera)),
          ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Escolher da galeria'), onTap: () => Navigator.pop(context, ImageSource.gallery)),
        ]),
      ),
    );
    if (source == null) return;
    try {
      final file = await ImagePicker().pickImage(source: source, maxWidth: 1600, maxHeight: 1600, imageQuality: 80);
      if (file != null) onChanged(file);
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Não foi possível abrir a câmara ou a galeria.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _pick(context),
        child: value == null
            ? Padding(
                padding: const EdgeInsets.all(20),
                child: Row(children: [
                  const Icon(Icons.add_a_photo_outlined),
                  const SizedBox(width: 12),
                  Expanded(child: Text(required ? '$label (obrigatório)' : label)),
                ]),
              )
            : Stack(children: [
                Image.file(File(value!.path), height: 180, width: double.infinity, fit: BoxFit.cover),
                Positioned(
                  right: 8,
                  top: 8,
                  child: IconButton.filledTonal(
                    tooltip: 'Remover foto',
                    onPressed: () => onChanged(null),
                    icon: const Icon(Icons.close),
                  ),
                ),
                Positioned(
                  left: 12,
                  bottom: 8,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(color: theme.colorScheme.surface.withValues(alpha: 0.85), borderRadius: BorderRadius.circular(8)),
                    child: const Text('Tocar para trocar'),
                  ),
                ),
              ]),
      ),
    );
  }
}

/// Imagem de um ficheiro protegido da API (envia o token).
class AuthImage extends ConsumerWidget {
  const AuthImage(this.fileId, {super.key, this.height = 180, this.fit = BoxFit.cover});

  final String fileId;
  final double? height;
  final BoxFit fit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.watch(apiProvider);
    return Image.network(
      api.fileUrl(fileId),
      headers: api.authHeaders,
      height: height,
      width: double.infinity,
      fit: fit,
      errorBuilder: (_, _, _) => SizedBox(
        height: height,
        child: const Center(child: Icon(Icons.picture_as_pdf_outlined, size: 40)),
      ),
    );
  }
}
