// Percorre a app real contra um backend com os dados de `npm run seed:demo`:
//   flutter drive --driver=test_driver/integration_test.dart --target=integration_test/app_flow_test.dart \
//     --dart-define=DEMO_LOGIN=... --dart-define=DEMO_PASSWORD=... --dart-define=DEMO_CODE=...
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:uhocha_frota/main.dart' as app;

import 'helpers.dart';

const demoLogin = String.fromEnvironment('DEMO_LOGIN');
const demoPassword = String.fromEnvironment('DEMO_PASSWORD');
const demoCode = String.fromEnvironment('DEMO_CODE');
const demoPhone = String.fromEnvironment('DEMO_PHONE', defaultValue: '923000101');

void main() {
  final binding = testBinding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('gestor e motorista: entrar, navegar e sair', (tester) async {
    app.main();
    await binding.convertFlutterSurfaceToImage();
    await ensureSignedOut(tester);
    await waitFor(tester, find.byKey(const Key('login')));
    await settle(tester);
    await binding.takeScreenshot('01_login');

    // --- gestor ---
    await tester.enterText(find.byKey(const Key('login')), demoLogin);
    await tester.enterText(find.byKey(const Key('password')), demoPassword);
    await tester.ensureVisible(find.byKey(const Key('submit')));
    await tester.tap(find.byKey(const Key('submit')));
    await waitFor(tester, find.textContaining('ENTREGA DA SEMANA'));
    await settle(tester);
    expect(find.textContaining('Erasmo'), findsWidgets);
    await binding.takeScreenshot('02_gestor_inicio');

    await tester.tap(find.text('Cobranças').last);
    await waitFor(tester, find.textContaining('Prazo'));
    await settle(tester);
    expect(find.text('Pedro Afonso'), findsOneWidget);
    await binding.takeScreenshot('03_gestor_cobrancas');

    await tester.tap(find.text('Frota').last);
    await waitFor(tester, find.textContaining('HL-10-01-AA'));
    await settle(tester);
    await binding.takeScreenshot('04_gestor_frota');

    await tester.tap(find.text('Registar'));
    await waitFor(tester, find.text('Receber pagamento'));
    await settle(tester);
    await binding.takeScreenshot('05_gestor_acoes');
    await tester.tapAt(const Offset(20, 80)); // fecha a folha
    await settle(tester);

    await tester.tap(find.text('Mais').last);
    await waitFor(tester, find.text('Sair'));
    await tester.tap(find.text('Sair'));
    await waitFor(tester, find.widgetWithText(FilledButton, 'Sair'));
    await tester.tap(find.widgetWithText(FilledButton, 'Sair'));
    await waitFor(tester, find.byKey(const Key('login')));

    // --- motorista: ativação com código + PIN ---
    await tester.tap(find.textContaining('código de ativação'));
    await waitFor(tester, find.text('Ativar conta'));
    await tester.enterText(find.byKey(const Key('activate_phone')), demoPhone);
    await tester.enterText(find.byKey(const Key('activate_code')), demoCode);
    await tester.enterText(find.byKey(const Key('activate_pin')), '482916');
    await tester.enterText(find.byKey(const Key('activate_pin_again')), '482916');
    await tester.ensureVisible(find.text('Ativar e entrar'));
    await settle(tester);
    await tester.tap(find.text('Ativar e entrar'));
    await waitFor(tester, find.textContaining('Próxima entrega'));
    await settle(tester);
    expect(find.textContaining('João'), findsWidgets);
    await binding.takeScreenshot('06_motorista_inicio');

    await tester.tap(find.text('Pagamentos').last);
    await waitFor(tester, find.text('Cobranças'));
    await settle(tester);
    await binding.takeScreenshot('07_motorista_pagamentos');

    await tester.tap(find.text('Perfil').last);
    await waitFor(tester, find.text('Contactos de emergência'));
    await settle(tester);
    await binding.takeScreenshot('08_motorista_perfil');
  });
}
