import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';
import '../../core/widgets/widgets.dart';
import '../shared/models.dart';
import '../shared/providers.dart';
import '../shared/statement_view.dart';

/// Ficha do motorista para o gestor: contacto, viatura, acesso à app e conta corrente.
class DriverDetailScreen extends ConsumerWidget {
  const DriverDetailScreen({super.key, required this.driverId});

  final String driverId;

  Future<void> _invite(BuildContext context, WidgetRef ref, Map<String, dynamic> driver) async {
    try {
      final invite = await ref.read(apiProvider).post<Map<String, dynamic>>('/drivers/$driverId/invite', {});
      ref.invalidate(driverDetailProvider(driverId));
      if (!context.mounted) return;
      final code = '${invite['code']}';
      final phone = '${invite['phone']}'.replaceAll(RegExp(r'\D'), '');
      final message = 'Olá ${driver['name']}! Instale a app UHOCHA Frota e ative a sua conta com o telefone e o código $code (válido ${invite['expiresInHours']} horas).';
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Código de ativação'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            SelectableText(code, style: Theme.of(context).textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: 6)),
            const SizedBox(height: 8),
            Text('Válido ${invite['expiresInHours']} horas. Partilhe só com o motorista.', textAlign: TextAlign.center),
          ]),
          actions: [
            TextButton(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: code));
                Navigator.pop(context);
              },
              child: const Text('Copiar'),
            ),
            FilledButton.icon(
              onPressed: () {
                launchUrl(Uri.parse('https://wa.me/$phone?text=${Uri.encodeComponent(message)}'), mode: LaunchMode.externalApplication);
                Navigator.pop(context);
              },
              icon: const Icon(Icons.send),
              label: const Text('WhatsApp'),
            ),
          ],
        ),
      );
    } on ApiException catch (error) {
      if (context.mounted) showMessage(context, error.message);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(driverDetailProvider(driverId));
    final name = detail.value?.data['name'] as String?;
    return Scaffold(
      appBar: AppBar(title: Text(name ?? 'Motorista'), actions: [
        if (detail.value != null)
          IconButton(
            tooltip: 'Editar',
            onPressed: () => context.push('/motoristas/$driverId/editar', extra: detail.value!.data),
            icon: const Icon(Icons.edit_outlined),
          ),
      ]),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/pagamentos/receber?motorista=$driverId'),
        icon: const Icon(Icons.payments_outlined),
        label: const Text('Receber'),
      ),
      body: CachedBody<Statement>(
        provider: driverStatementProvider(driverId),
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
        builder: (context, statement) {
          final driver = detail.value?.data;
          final assignment = driver?['activeAssignment'] as Map?;
          final access = driver?['appAccess'] as Map?;
          final phone = driver?['phone'] as String?;
          return [
            if (driver != null)
              Card(
                child: Column(children: [
                  ListTile(
                    leading: Avatar('${driver['name']}', radius: 24),
                    title: Text('${driver['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text(assignment == null ? 'Sem viatura' : '${assignment['brand']} ${assignment['model']} · ${assignment['plate'] ?? ''}'),
                    trailing: assignment == null
                        ? TextButton(onPressed: () => context.push('/atribuir?motorista=$driverId'), child: const Text('Atribuir'))
                        : const Icon(Icons.chevron_right),
                    onTap: assignment == null ? null : () => context.push('/viaturas/${assignment['vehicle_id']}'),
                  ),
                  if (phone != null)
                    Row(children: [
                      Expanded(
                        child: TextButton.icon(
                          onPressed: () => launchUrl(Uri.parse('tel:$phone')),
                          icon: const Icon(Icons.call_outlined),
                          label: const Text('Ligar'),
                        ),
                      ),
                      Expanded(
                        child: TextButton.icon(
                          onPressed: () => launchUrl(Uri.parse('https://wa.me/${phone.replaceAll(RegExp(r'\D'), '')}'), mode: LaunchMode.externalApplication),
                          icon: const Icon(Icons.chat_outlined),
                          label: const Text('WhatsApp'),
                        ),
                      ),
                    ]),
                  const Divider(height: 1),
                  ListTile(
                    leading: const Icon(Icons.upload_file_outlined),
                    title: Text('Documentos (${(driver['documents'] as List? ?? const []).length})'),
                    trailing: TextButton(
                      onPressed: () => context.push('/documentos/novo?dono=driver&id=$driverId'),
                      child: const Text('Adicionar'),
                    ),
                  ),
                  ListTile(
                    leading: Icon(access?['activated'] == true ? Icons.phone_iphone : Icons.mobile_off_outlined),
                    title: Text(access?['activated'] == true ? 'Usa a app' : 'Ainda não usa a app'),
                    trailing: TextButton(
                      onPressed: phone == null ? null : () => _invite(context, ref, driver),
                      child: Text(access?['activated'] == true ? 'Novo código' : 'Convidar'),
                    ),
                  ),
                ]),
              ),
            const SizedBox(height: 12),
            ...statementWidgets(context, statement, driverName: driver?['name'] as String?),
          ];
        },
      ),
    );
  }
}
