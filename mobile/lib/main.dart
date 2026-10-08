import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';

import 'app/router.dart';
import 'app/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  Intl.defaultLocale = 'pt_PT';
  await initializeDateFormatting('pt_PT');
  // Sem novas tentativas automáticas: os ecrãs mostram "Tentar de novo" e aceitam puxar para atualizar.
  runApp(ProviderScope(retry: (_, _) => null, child: const UhochaApp()));
}

class UhochaApp extends ConsumerWidget {
  const UhochaApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => MaterialApp.router(
        title: 'UHOCHA Frota',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(Brightness.light),
        darkTheme: buildTheme(Brightness.dark),
        routerConfig: ref.watch(routerProvider),
        locale: const Locale('pt', 'PT'),
        supportedLocales: const [Locale('pt', 'PT'), Locale('pt')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
      );
}
