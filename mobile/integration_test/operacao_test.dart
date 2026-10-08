// Fase 5 — operação (dados de `npm run seed:demo`; o João tem PIN definido pelo script de reposição):
// despesa em lote, documento, ocorrência do gestor e resolução, contrato; o motorista comunica uma ocorrência.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:uhocha_frota/main.dart' as app;

import 'helpers.dart';

const login = String.fromEnvironment('DEMO_LOGIN');
const password = String.fromEnvironment('DEMO_PASSWORD');
const driverPin = String.fromEnvironment('DEMO_DRIVER_PIN');

Future<void> openMore(WidgetTester tester, String item) async {
  await settle(tester); // os toques são ignorados durante a animação de transição
  await tester.tap(find.text('Mais').last);
  await waitFor(tester, find.text(item));
  await tester.tap(find.text(item));
}

Future<void> goBack(WidgetTester tester) async {
  await settle(tester);
  await tester.tap(find.byType(BackButton).last);
}

Future<void> tapVisible(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 300, scrollable: find.byType(Scrollable).first);
  await settle(tester);
  await tester.tap(finder);
}

void main() {
  final binding = testBinding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('gestor e motorista: despesas, documentos, ocorrências e contrato', (tester) async {
    app.main();
    await binding.convertFlutterSurfaceToImage();
    await ensureSignedOut(tester);
    await signIn(tester, login, password);
    await waitFor(tester, find.textContaining('ENTREGA DA SEMANA'));

    // --- despesa: dividir um total por todas as viaturas ativas ---
    await openMore(tester, 'Despesas');
    await waitFor(tester, find.byKey(const Key('new_expense')));
    await tester.tap(find.byKey(const Key('new_expense')));
    await waitFor(tester, find.text('Dividir total'));
    await tester.tap(find.text('Dividir total'));
    await settle(tester);
    await tester.tap(find.text('Todas as viaturas ativas'));
    // 4 viaturas ativas (3 em serviço + 1 disponível): 100 001 = 25 001 + 3 × 25 000.
    await tester.enterText(find.byKey(const Key('expense_amount')), '100001');
    await settle(tester);
    expect(find.textContaining('4 viaturas · total 100\u00A0001\u00A0Kz'), findsOneWidget);
    expect(find.textContaining('Cada viatura: 25\u00A0001\u00A0Kz ou 25\u00A0000\u00A0Kz'), findsOneWidget);
    await binding.takeScreenshot('30_despesa_lote');
    await tapVisible(tester, find.byKey(const Key('save_expense')));
    await waitFor(tester, find.textContaining('lote de 4 viaturas'));
    await settle(tester);
    await binding.takeScreenshot('31_despesas');
    await goBack(tester);
    await settle(tester);

    // --- documento de um motorista ---
    await openMore(tester, 'Documentos');
    await waitFor(tester, find.byKey(const Key('new_document')));
    await settle(tester);
    await binding.takeScreenshot('32_documentos_a_tratar');
    await tester.tap(find.byKey(const Key('new_document')));
    await waitFor(tester, find.text('Novo documento'));
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await waitFor(tester, find.text('Carlos Neto'));
    await tester.tap(find.text('Carlos Neto').last);
    await settle(tester);
    await tester.tap(find.text('Bilhete de Identidade'));
    await tester.enterText(find.widgetWithText(TextField, 'Número / referência'), '004455667LA041');
    await tapVisible(tester, find.byKey(const Key('save_document')));
    await waitFor(tester, find.text('Todos'));
    await tester.tap(find.text('Todos'));
    await waitFor(tester, find.textContaining('Bilhete de Identidade · Carlos Neto'));
    await goBack(tester);
    await settle(tester);

    // --- ocorrência registada pelo gestor e resolvida ---
    await openMore(tester, 'Ocorrências');
    await waitFor(tester, find.byKey(const Key('new_incident')));
    await tester.tap(find.byKey(const Key('new_incident')));
    await waitFor(tester, find.byKey(const Key('incident_vehicle')));
    await tester.tap(find.byKey(const Key('incident_vehicle')));
    await waitFor(tester, find.textContaining('HL-30-03-CC'));
    await tester.tap(find.textContaining('HL-30-03-CC').last);
    await settle(tester);
    await tester.enterText(find.byKey(const Key('incident_notes')), 'Embraiagem a patinar');
    await settle(tester);
    await binding.takeScreenshot('33_nova_ocorrencia');
    await tapVisible(tester, find.byKey(const Key('save_incident')));
    await waitFor(tester, find.text('Embraiagem a patinar'));
    await settle(tester);
    await binding.takeScreenshot('34_ocorrencias');
    await tester.tap(find.text('Resolver').first);
    await waitFor(tester, find.textContaining('Ocorrência resolvida'));
    await goBack(tester);
    await settle(tester);

    // --- contrato (gestor vê, não altera) ---
    await openMore(tester, 'Contrato e valores');
    await waitFor(tester, find.text('Entrega semanal'));
    expect(find.byKey(const Key('edit_contract')), findsNothing);
    await settle(tester);
    await binding.takeScreenshot('35_contrato');
    await goBack(tester);
    await settle(tester);

    // --- motorista comunica uma ocorrência ---
    await ensureSignedOut(tester);
    await signIn(tester, '923000101', driverPin);
    await waitFor(tester, find.textContaining('Próxima entrega'));
    await tester.tap(find.text('Enviar'));
    await waitFor(tester, find.text('Comunicar ocorrência'));
    await tester.tap(find.text('Comunicar ocorrência'));
    await waitFor(tester, find.byKey(const Key('incident_type_doenca')));
    await tester.tap(find.byKey(const Key('incident_type_doenca')));
    await tester.enterText(find.byKey(const Key('incident_notes')), 'Febre alta, com baixa médica');
    await settle(tester);
    await binding.takeScreenshot('36_motorista_ocorrencia');
    await tapVisible(tester, find.byKey(const Key('save_incident')));
    await waitFor(tester, find.text('À espera da gestão'));
    await settle(tester);
    await binding.takeScreenshot('37_motorista_inicio');
  });
}
