import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../api/api_error.dart';
import '../cache/json_cache.dart';
import '../format/format.dart';

enum Tone { ok, warn, danger, info, neutral }

Color toneColor(Tone tone, ColorScheme scheme) => switch (tone) {
      Tone.ok => Brand.ok,
      Tone.warn => Brand.warn,
      Tone.danger => Brand.danger,
      Tone.info => scheme.primary,
      Tone.neutral => scheme.onSurfaceVariant,
    };

class StatusChip extends StatelessWidget {
  const StatusChip(this.label, {super.key, this.tone = Tone.neutral, this.icon});

  final String label;
  final Tone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final color = toneColor(tone, Theme.of(context).colorScheme);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(99)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 14, color: color), const SizedBox(width: 4)],
        Text(label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
      ]),
    );
  }
}

class KpiCard extends StatelessWidget {
  const KpiCard({super.key, required this.label, required this.value, this.caption, this.highlight = false, this.onTap});

  final String label;
  final String value;
  final String? caption;
  final bool highlight;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final foreground = highlight ? Brand.graphite : theme.colorScheme.onSurface;
    return Card(
      color: highlight ? Brand.lime : null,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label.toUpperCase(), style: theme.textTheme.labelSmall?.copyWith(color: foreground.withValues(alpha: 0.7), letterSpacing: 0.6)),
            const SizedBox(height: 6),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(value, style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800, color: foreground)),
            ),
            if (caption != null) ...[
              const SizedBox(height: 4),
              Text(caption!, style: theme.textTheme.bodySmall?.copyWith(color: foreground.withValues(alpha: 0.75))),
            ],
          ]),
        ),
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 20, 4, 8),
        child: Row(children: [
          Expanded(child: Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700))),
          ?trailing,
        ]),
      );
}

class EmptyState extends StatelessWidget {
  const EmptyState(this.message, {super.key, this.icon = Icons.inbox_outlined});

  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 16),
        child: Column(children: [
          Icon(icon, size: 40, color: Theme.of(context).colorScheme.onSurfaceVariant),
          const SizedBox(height: 8),
          Text(message, textAlign: TextAlign.center, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
        ]),
      );
}

/// Corpo de um ecrã alimentado por um provider `Cached<T>`: carregamento, erro com "Tentar de novo",
/// aviso quando os dados vêm da cópia guardada, e puxar para atualizar.
class CachedBody<T> extends ConsumerWidget {
  const CachedBody({super.key, required this.provider, required this.builder, this.padding = const EdgeInsets.fromLTRB(16, 8, 16, 32)});

  final FutureProvider<Cached<T>> provider;
  final List<Widget> Function(BuildContext context, T data) builder;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final value = ref.watch(provider);
    Future<void> refresh() => ref.refresh(provider.future).then((_) {}, onError: (_) {});
    return value.when(
      skipLoadingOnRefresh: true,
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => ErrorRetry(error: error, onRetry: () => ref.invalidate(provider)),
      data: (cached) => RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          padding: padding,
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            if (cached.fromCache) OfflineBanner(savedAt: cached.savedAt),
            ...builder(context, cached.data),
          ],
        ),
      ),
    );
  }
}

class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key, required this.savedAt});

  final DateTime savedAt;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Brand.warn.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(14)),
        child: Row(children: [
          const Icon(Icons.cloud_off, color: Brand.warn, size: 18),
          const SizedBox(width: 8),
          Expanded(child: Text('Sem ligação — a mostrar dados de ${formatDateTime(savedAt)}.')),
        ]),
      );
}

class ErrorRetry extends StatelessWidget {
  const ErrorRetry({super.key, required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(error is ApiException && (error as ApiException).isOffline ? Icons.cloud_off : Icons.error_outline, size: 40),
            const SizedBox(height: 12),
            Text(error is ApiException ? '$error' : 'Não foi possível carregar.', textAlign: TextAlign.center),
            const SizedBox(height: 16),
            OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Tentar de novo')),
          ]),
        ),
      );
}

class Avatar extends StatelessWidget {
  const Avatar(this.name, {super.key, this.radius = 20});

  final String name;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final initials = name.trim().split(RegExp(r'\s+')).where((part) => part.isNotEmpty).take(2).map((part) => part[0].toUpperCase()).join();
    return CircleAvatar(
      radius: radius,
      backgroundColor: Brand.graphite,
      child: Text(initials, style: TextStyle(color: Brand.lime, fontWeight: FontWeight.w700, fontSize: radius * 0.75)),
    );
  }
}

void showMessage(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message), behavior: SnackBarBehavior.floating));
}
