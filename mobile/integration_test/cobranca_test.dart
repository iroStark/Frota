// Fase 4 — o gestor trata a cobrança pelo telemóvel (dados de `npm run seed:demo`):
// confirmar um comprovativo pendente, receber um pagamento, entrega em grupo, ficha e convite.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:uhocha_frota/main.dart' as app;

import 'helpers.dart';

const login = String.fromEnvironment('DEMO_LOGIN');
const password = String.fromEnvironment('DEMO_PASSWORD');

void main() {
  final binding = testBinding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('gestor: validar, receber, grupo e ficha do motorista', (tester) async {
    app.main();
    await binding.convertFlutterSurfaceToImage();
    await ensureSignedOut(tester);
    await signIn(tester, login, password);
    await waitFor(tester, find.textContaining('ENTREGA DA SEMANA'));

    // --- Para validar: o comprovativo enviado pelo João ---
    await waitFor(tester, find.text('Para validar'));
    await tester.tap(find.text('Para validar'));
    await waitFor(tester, find.textContaining('João Manuel ·'));
    await settle(tester);
    await binding.takeScreenshot('10_para_validar');
    await tester.tap(find.widgetWithText(FilledButton, 'Confirmar').first);
    await waitFor(tester, find.text('Confirmar pagamento'));
    await settle(tester);
    await binding.takeScreenshot('11_confirmar_valor');
    await tester.tap(find.widgetWithText(FilledButton, 'Confirmar').last);
    await waitFor(tester, find.text('Nenhum comprovativo por confirmar.'));
    await tester.tap(find.byType(BackButton));
    await settle(tester);

    // --- Receber: Pedro (em dívida) a partir das Cobranças ---
    await tester.tap(find.text('Cobranças').last);
    await waitFor(tester, find.text('Pedro Afonso'));
    await tester.tap(find.text('Pedro Afonso'));
    await waitFor(tester, find.text('Vai pagar'));
    await settle(tester);
    await binding.takeScreenshot('12_receber_previsao');
    await tester.enterText(find.byKey(const Key('amount')), '150000');
    await settle(tester);
    // 1.ª semana (86 667) fica paga; a 2.ª fica com 63 333 de 130 000.
    expect(find.textContaining('63\u00A0333\u00A0Kz de 130\u00A0000\u00A0Kz'), findsOneWidget);
    await binding.takeScreenshot('13_receber_parcial');
    await tester.scrollUntilVisible(find.byKey(const Key('save_payment')), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const Key('save_payment')));
    await waitFor(tester, find.textContaining('Pagamento registado'));
    await waitGone(tester, find.byType(SnackBar)); // o aviso tapa o fundo do ecrã durante uns segundos

    // --- Entrega em grupo ---
    await waitFor(tester, find.byTooltip('Entrega em grupo'));
    await tester.tap(find.byTooltip('Entrega em grupo'));
    await waitFor(tester, find.text('Selecionar todos'));
    await tester.tap(find.text('Selecionar todos'));
    await settle(tester);
    await binding.takeScreenshot('14_grupo');
    final register = find.textContaining('Registar ');
    await tester.scrollUntilVisible(register, 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(register);
    await waitFor(tester, find.textContaining('pagamento(s) registado(s)'));

    // --- Ficha do motorista e convite ---
    await tester.tap(find.text('Frota').last);
    await waitFor(tester, find.text('Motoristas'));
    await tester.tap(find.text('Motoristas'));
    await waitFor(tester, find.text('Carlos Neto'));
    await tester.tap(find.text('Carlos Neto'));
    await waitFor(tester, find.text('Ainda não usa a app'));
    await settle(tester);
    await binding.takeScreenshot('15_ficha_motorista');
    await tester.tap(find.text('Convidar'));
    await waitFor(tester, find.text('Código de ativação'));
    await settle(tester);
    final code = tester.widget<SelectableText>(find.byType(SelectableText)).data ?? '';
    expect(RegExp(r'^\d{6}$').hasMatch(code), isTrue);
    await tester.tap(find.text('Copiar'));
    await settle(tester);
  });
}
