# UHOCHA Frota — app móvel (Flutter)

Uma só app para a **equipa** (admin/gestor) e para os **motoristas**: depois de entrar, a navegação muda conforme o perfil.

## Requisitos

- Flutter 3.44+ (Dart 3.10+).
- iOS: Xcode selecionado (`sudo xcode-select -s /Applications/Xcode-beta.app/Contents/Developer` ou o caminho do seu Xcode); alvo mínimo iOS 15.
- Android: Android SDK com *cmdline-tools* e licenças aceites (`flutter doctor --android-licenses`).

## Correr contra o backend local

```bash
# na raiz do repositório: base de demonstração (credenciais no topo de backend/cli/seed-demo.ts)
createdb uhocha_demo
DATABASE_URL=postgresql://localhost:5432/uhocha_demo npm run seed:demo
DATABASE_URL=postgresql://localhost:5432/uhocha_demo JWT_SECRET=dev APP_ACCESS_KEY=dev npm start

# noutra janela
cd mobile
flutter run --dart-define=API_URL=http://localhost:3000      # iOS
flutter run --dart-define=API_URL=http://10.0.2.2:3000       # emulador Android
```

`API_URL` por omissão é `http://localhost:3000`. Em produção: `--dart-define=API_URL=https://<domínio>`.

## Estrutura

```
lib/
  app/        env, tema (cores UHOCHA), router (redirecionamento por sessão e perfil)
  core/
    api/      cliente HTTP (Bearer + renovação única partilhada do token), erros
    auth/     sessão (login, ativação do motorista, bloqueio biométrico), armazenamento seguro
    cache/    cache JSON: rede primeiro, última cópia guardada sem ligação
    format/   kwanzas, datas na hora de Luanda, contagem do prazo
    widgets/  cartões, estados, carregamento/erro/sem ligação
  features/
    auth/     entrar, ativar conta (código + PIN), desbloquear
    staff/    Início (painel), Cobranças, Frota, Alertas
    driver/   Início, Pagamentos (detalhe por dias), Perfil
    shared/   modelos, providers, cascas de navegação, Mais
```

## Testes

```bash
flutter analyze
flutter test                                    # unitários e de widgets
# fluxo completo no simulador contra o backend local (guarda capturas em build/screenshots/):
flutter drive --driver=test_driver/integration_test.dart --target=integration_test/app_flow_test.dart \
  --dart-define=DEMO_LOGIN=<email admin> --dart-define=DEMO_PASSWORD=<palavra-passe> --dart-define=DEMO_CODE=<código de ativação>
```

## Sem rede

Pagamentos, entregas em grupo, comprovativos e despesas registados sem ligação ficam em fila (`lib/core/offline/outbox.dart`, com cópia das fotos) e são enviados automaticamente. Cada pedido leva um `clientId`, por isso repetir nunca duplica. A faixa "N registo(s) por enviar" mostra o estado; ao sair da conta a fila é apagada.

## Notificações push (por fazer)

O servidor já envia por FCM quando `FCM_SERVICE_ACCOUNT` está definido. Falta na app:

1. `dart pub global activate flutterfire_cli && flutterfire configure` (gera `firebase_options.dart`, `google-services.json`, `GoogleService-Info.plist`).
2. `flutter pub add firebase_core firebase_messaging`, pedir permissão, obter o token e enviá-lo para `POST /api/v1/me/devices` (`{token, platform}`); ao sair, `DELETE /api/v1/me/devices/:token`.
3. Ao tocar na notificação, abrir `data.route` com o `go_router`.
