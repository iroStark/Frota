import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/api/api_client.dart';
import '../../core/auth/session.dart';
import '../../core/format/format.dart';
import '../../core/widgets/widgets.dart';
import 'providers.dart';

/// Sino com o número de avisos por ler.
class NotificationsBell extends ConsumerWidget {
  const NotificationsBell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = asInt(ref.watch(notificationsProvider).value?.data['unread']);
    return IconButton(
      key: const Key('notifications_bell'),
      tooltip: 'Avisos',
      onPressed: () => context.push('/avisos'),
      icon: Badge(isLabelVisible: unread > 0, label: Text('$unread'), child: const Icon(Icons.notifications_outlined)),
    );
  }
}

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  // Guardados ao abrir: no dispose já não se pode usar `ref` (Riverpod 3).
  late final ApiClient _api;
  late final ProviderContainer _container;

  @override
  void initState() {
    super.initState();
    _api = ref.read(apiProvider);
    _container = ProviderScope.containerOf(context, listen: false);
  }

  @override
  void dispose() {
    // Ao sair, tudo o que foi visto fica lido e o número no sino atualiza.
    _api.post<Map<String, dynamic>>('/me/notifications/read', {}).then(
      (_) => _container.invalidate(notificationsProvider),
      onError: (_) {},
    );
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Avisos')),
        body: CachedBody<Map<String, dynamic>>(
          provider: notificationsProvider,
          builder: (context, data) {
            final items = (data['items'] as List).cast<Map>();
            if (items.isEmpty) return [const EmptyState('Sem avisos.', icon: Icons.notifications_none)];
            return [
              for (final item in items)
                Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  color: item['readAt'] == null ? Brand.lime.withValues(alpha: 0.35) : null,
                  child: ListTile(
                    title: Text('${item['title']}', style: TextStyle(fontWeight: item['readAt'] == null ? FontWeight.w700 : FontWeight.w500)),
                    subtitle: Text('${item['body']}\n${formatDateTime(DateTime.parse('${item['createdAt']}'))}'),
                    isThreeLine: true,
                    trailing: item['route'] == null ? null : const Icon(Icons.chevron_right),
                    onTap: item['route'] == null ? null : () => context.push('${item['route']}'),
                  ),
                ),
            ];
          },
        ),
      );
}
