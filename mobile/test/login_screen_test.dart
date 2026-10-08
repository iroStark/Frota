import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uhocha_frota/core/auth/session.dart';
import 'package:uhocha_frota/features/auth/auth_screens.dart';

import 'fakes.dart';

void main() {
  testWidgets('valida os campos antes de pedir ao servidor', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [tokenStoreProvider.overrideWithValue(MemoryTokenStore())],
      child: const MaterialApp(home: LoginScreen()),
    ));
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pump();
    expect(find.text('Indique o email ou o telefone.'), findsOneWidget);
    expect(find.text('Indique a palavra-passe ou o PIN.'), findsOneWidget);
  });
}
