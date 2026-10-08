// Fase 6 — avisos e relatórios (dados de `npm run seed:demo` + comprovativo pendente do script de reposição).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:uhocha_frota/main.dart' as app;

import 'helpers.dart';

const login = String.fromEnvironment('DEMO_LOGIN');
const password = String.fromEnvironment('DEMO_PASSWORD');

void main() {
  final binding = testBinding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('gestor: avisos e relatórios', (tester) async {
    app.main();
    await binding.convertFlutterSurfaceToImage();
    await ensureSignedOut(tester);
    await signIn(tester, login, password);
    await waitFor(tester, find.textContaining('ENTREGA DA SEMANA'));
    await settle(tester);

    // --- avisos: o comprovativo enviado pelo motorista chegou à gestão ---
    await waitFor(tester, find.byType(Badge));
    await tester.tap(find.byKey(const Key('notifications_bell')));
    await waitFor(tester, find.textContaining('Comprovativo de João'));
    await settle(tester);
    await binding.takeScreenshot('40_avisos');
    await tester.tap(find.textContaining('Comprovativo de João'));
    await waitFor(tester, find.text('Para validar'));
    await settle(tester);
    await tester.tap(find.byType(BackButton).last);
    await settle(tester);
    await tester.tap(find.byType(BackButton).last);
    await settle(tester);

    // --- relatórios ---
    await tester.tap(find.text('Mais').last);
    await waitFor(tester, find.text('Relatórios'));
    await tester.tap(find.text('Relatórios'));
    await waitFor(tester, find.text('Líquido do período'.toUpperCase()));
    await tester.tap(find.text('3 meses'));
    await waitFor(tester, find.text('Esperado e recebido por semana'));
    await settle(tester);
    await binding.takeScreenshot('41_relatorio');
    await tester.scrollUntilVisible(find.text('Viaturas'), 300, scrollable: find.byType(Scrollable).last);
    await settle(tester);
    await binding.takeScreenshot('42_relatorio_motoristas');
    expect(find.byTooltip('Exportar CSV'), findsOneWidget);
  });
}
