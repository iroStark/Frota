import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

late IntegrationTestWidgetsFlutterBinding testBinding;

Future<void> waitFor(WidgetTester tester, Finder finder, {Duration timeout = const Duration(seconds: 20)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 200));
    if (finder.evaluate().isNotEmpty) return;
  }
  // Ajuda a diagnosticar: captura do ecrã e textos visíveis no momento da falha.
  await testBinding.takeScreenshot('falha');
  throw TestFailure('Não apareceu: $finder\nNo ecrã: ${_visibleTexts()}');
}

/// Espera até aparecer um dos elementos e devolve o índice do primeiro encontrado.
Future<int> waitForAny(WidgetTester tester, List<Finder> finders, {Duration timeout = const Duration(seconds: 30)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 200));
    for (var index = 0; index < finders.length; index++) {
      if (finders[index].evaluate().isNotEmpty) return index;
    }
  }
  await testBinding.takeScreenshot('falha');
  throw TestFailure('Nenhum apareceu: $finders\nNo ecrã: ${_visibleTexts()}');
}

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 150));
  }
}


/// Sai da sessão que tenha ficado guardada de uma execução anterior.
Future<void> ensureSignedOut(WidgetTester tester) async {
  final start = await waitForAny(tester, [find.byKey(const Key('login')), find.byType(NavigationBar)]);
  if (start == 0) return;
  await tester.tap(find.text(find.text('Perfil').evaluate().isNotEmpty ? 'Perfil' : 'Mais').last);
  await waitFor(tester, find.text('Sair'));
  await tester.scrollUntilVisible(find.text('Sair'), 200, scrollable: find.byType(Scrollable).last);
  await tester.tap(find.text('Sair'));
  await waitFor(tester, find.widgetWithText(FilledButton, 'Sair'));
  await tester.tap(find.widgetWithText(FilledButton, 'Sair'));
  await waitFor(tester, find.byKey(const Key('login')));
}

Future<void> signIn(WidgetTester tester, String login, String password) async {
  await tester.enterText(find.byKey(const Key('login')), login);
  await tester.enterText(find.byKey(const Key('password')), password);
  await tester.ensureVisible(find.byKey(const Key('submit')));
  await tester.tap(find.byKey(const Key('submit')));
}

String _visibleTexts() =>
    find.byType(Text).evaluate().map((element) => (element.widget as Text).data).whereType<String>().take(30).join(' | ');

Future<void> waitGone(WidgetTester tester, Finder finder, {Duration timeout = const Duration(seconds: 10)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end) && finder.evaluate().isNotEmpty) {
    await tester.pump(const Duration(milliseconds: 200));
  }
}
