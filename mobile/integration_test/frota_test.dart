// Fase 4 — ciclo da viatura pelo telemóvel (dados de `npm run seed:demo`):
// registar viatura → registar motorista → atribuir com checklist → devolver com acerto.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:uhocha_frota/main.dart' as app;

import 'helpers.dart';

const login = String.fromEnvironment('DEMO_LOGIN');
const password = String.fromEnvironment('DEMO_PASSWORD');

Future<void> tapVisible(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await settle(tester);
  await tester.tap(finder);
}

void main() {
  final binding = testBinding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('gestor: registar, atribuir e devolver', (tester) async {
    app.main();
    await binding.convertFlutterSurfaceToImage();
    await ensureSignedOut(tester);
    await signIn(tester, login, password);
    await waitFor(tester, find.textContaining('ENTREGA DA SEMANA'));

    // --- nova viatura ---
    await tester.tap(find.text('Frota').last);
    await waitFor(tester, find.byKey(const Key('fleet_add')));
    await tester.tap(find.byKey(const Key('fleet_add')));
    await waitFor(tester, find.text('Nova viatura'));
    await tester.enterText(find.byKey(const Key('brand')), 'Toyota');
    await tester.enterText(find.byKey(const Key('model')), 'Hiace');
    await tester.enterText(find.byKey(const Key('plate')), 'ld-77-77-zz');
    await binding.takeScreenshot('20_nova_viatura');
    await tapVisible(tester, find.byKey(const Key('save_vehicle')));
    await waitFor(tester, find.text('LD-77-77-ZZ'));
    await settle(tester);
    expect(find.text('Disponível'), findsOneWidget);
    await binding.takeScreenshot('21_ficha_viatura_nova');
    await tester.tap(find.byType(BackButton));
    await settle(tester);

    // --- novo motorista (3 passos) ---
    await waitFor(tester, find.text('Motoristas'));
    await tester.tap(find.text('Motoristas'));
    await settle(tester);
    await tester.tap(find.byKey(const Key('fleet_add')));
    await waitFor(tester, find.byKey(const Key('driver_name')));
    await tester.enterText(find.byKey(const Key('driver_name')), 'Mateus Kiala');
    await tester.enterText(find.byKey(const Key('driver_phone')), '923555777');
    await binding.takeScreenshot('22_novo_motorista');
    await tapVisible(tester, find.byKey(const Key('step_next_0')));
    await waitFor(tester, find.byKey(const Key('step_next_1')));
    await tapVisible(tester, find.byKey(const Key('step_next_1')));
    await waitFor(tester, find.byKey(const Key('step_next_2')));
    await tester.enterText(find.widgetWithText(TextFormField, 'Caução entregue'), '50000');
    await tapVisible(tester, find.byKey(const Key('step_next_2')));
    await waitFor(tester, find.text('Mateus Kiala'));
    await waitFor(tester, find.text('Atribuir'));
    await settle(tester);

    // --- atribuir a viatura nova ao motorista novo ---
    await tester.tap(find.text('Atribuir'));
    await waitFor(tester, find.byKey(const Key('assign_vehicle')));
    await tester.tap(find.byKey(const Key('assign_vehicle')));
    await waitFor(tester, find.textContaining('LD-77-77-ZZ'));
    await tester.tap(find.textContaining('LD-77-77-ZZ').last);
    await settle(tester);
    await binding.takeScreenshot('23_atribuir_passo1');
    await tapVisible(tester, find.byKey(const Key('assign_next_0')));
    await waitFor(tester, find.textContaining('por dia'));
    await settle(tester);
    await binding.takeScreenshot('24_atribuir_condicoes');
    await tapVisible(tester, find.byKey(const Key('assign_next_1')));
    await waitFor(tester, find.text('Chaves'));
    await tester.tap(find.text('Chaves'));
    await tester.tap(find.text('Livrete'));
    await settle(tester);
    await binding.takeScreenshot('25_atribuir_checklist');
    await tapVisible(tester, find.byKey(const Key('assign_next_2')));
    await waitFor(tester, find.byKey(const Key('return_vehicle')));
    await settle(tester);
    expect(find.text('Em serviço'), findsOneWidget);
    expect(find.text('Mateus Kiala'), findsOneWidget);
    await binding.takeScreenshot('26_viatura_atribuida');

    // --- devolver com acerto ---
    await tapVisible(tester, find.byKey(const Key('return_vehicle')));
    await waitFor(tester, find.text('Data da devolução'));
    await settle(tester);
    // O botão está no fim de uma lista longa (só é construído quando se desliza até lá).
    await tester.scrollUntilVisible(find.byKey(const Key('confirm_return')), 400, scrollable: find.byType(Scrollable).first);
    await settle(tester);
    await binding.takeScreenshot('27_devolver');
    await tester.tap(find.byKey(const Key('confirm_return')));
    await waitFor(tester, find.widgetWithText(FilledButton, 'Devolver'));
    await tester.tap(find.widgetWithText(FilledButton, 'Devolver'));
    await waitFor(tester, find.text('Acerto da devolução'));
    await settle(tester);
    await binding.takeScreenshot('28_acerto');
    await tester.tap(find.text('Concluir'));
    await waitFor(tester, find.text('Disponível'));
    await settle(tester);
    await binding.takeScreenshot('29_viatura_devolvida');
  });
}
