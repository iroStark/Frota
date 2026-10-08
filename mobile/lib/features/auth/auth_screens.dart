import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_error.dart';
import '../../core/auth/session.dart';

class _AuthScaffold extends StatelessWidget {
  const _AuthScaffold({required this.title, required this.subtitle, required this.children});

  final String title;
  final String subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Center(child: ClipRRect(borderRadius: BorderRadius.circular(20), child: Image.asset('assets/logo.png', width: 88, height: 88))),
                const SizedBox(height: 24),
                Text(title, style: theme.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 6),
                Text(subtitle, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                const SizedBox(height: 24),
                ...children,
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

class _ErrorText extends StatelessWidget {
  const _ErrorText(this.message);

  final String? message;

  @override
  Widget build(BuildContext context) => message == null
      ? const SizedBox.shrink()
      : Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(message!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        );
}

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _login = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _obscure = true;
  String? _error;

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).login(_login.text, _password.text);
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _login.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return _AuthScaffold(
      title: 'Entrar',
      subtitle: 'Gestão da frota UHOCHA. Motoristas entram com o telefone e o PIN.',
      children: [
        Form(
          key: _form,
          child: AutofillGroup(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              TextFormField(
                key: const Key('login'),
                controller: _login,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.username],
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'Email ou telefone', prefixIcon: Icon(Icons.person_outline)),
                validator: (value) => (value ?? '').trim().length < 3 ? 'Indique o email ou o telefone.' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const Key('password'),
                controller: _password,
                obscureText: _obscure,
                autofillHints: const [AutofillHints.password],
                textInputAction: TextInputAction.done,
                onFieldSubmitted: (_) => _submit(),
                decoration: InputDecoration(
                  labelText: 'Palavra-passe ou PIN',
                  prefixIcon: const Icon(Icons.lock_outline),
                  suffixIcon: IconButton(
                    tooltip: _obscure ? 'Mostrar' : 'Esconder',
                    icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
                validator: (value) => (value ?? '').length < 4 ? 'Indique a palavra-passe ou o PIN.' : null,
              ),
              const SizedBox(height: 16),
              _ErrorText(_error),
              FilledButton(
                key: const Key('submit'),
                onPressed: _busy ? null : _submit,
                child: _busy ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5)) : const Text('Entrar'),
              ),
            ]),
          ),
        ),
        const SizedBox(height: 16),
        TextButton(
          onPressed: () => context.push('/ativar'),
          child: const Text('Sou motorista e recebi um código de ativação'),
        ),
      ],
    );
  }
}

class ActivateScreen extends ConsumerStatefulWidget {
  const ActivateScreen({super.key});

  @override
  ConsumerState<ActivateScreen> createState() => _ActivateScreenState();
}

class _ActivateScreenState extends ConsumerState<ActivateScreen> {
  final _form = GlobalKey<FormState>();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _pin = TextEditingController();
  final _pinAgain = TextEditingController();
  bool _busy = false;
  String? _error;

  static final _digits = [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)];

  String? _sixDigits(String? value, String what) => RegExp(r'^\d{6}$').hasMatch(value ?? '') ? null : '$what tem 6 dígitos.';

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).activate(_phone.text, _code.text, _pin.text);
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    for (final controller in [_phone, _code, _pin, _pinAgain]) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return _AuthScaffold(
      title: 'Ativar conta',
      subtitle: 'Use o código de 6 dígitos que o gestor lhe enviou e crie o seu PIN.',
      children: [
        Form(
          key: _form,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            TextFormField(
              key: const Key('activate_phone'),
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Telefone', prefixText: '+244 ', prefixIcon: Icon(Icons.phone_outlined)),
              validator: (value) => (value ?? '').replaceAll(RegExp(r'\D'), '').length < 9 ? 'Telefone com 9 dígitos.' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('activate_code'),
              controller: _code,
              keyboardType: TextInputType.number,
              inputFormatters: _digits,
              decoration: const InputDecoration(labelText: 'Código de ativação', prefixIcon: Icon(Icons.pin_outlined)),
              validator: (value) => _sixDigits(value, 'O código'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('activate_pin'),
              controller: _pin,
              keyboardType: TextInputType.number,
              obscureText: true,
              inputFormatters: _digits,
              decoration: const InputDecoration(labelText: 'Novo PIN (6 dígitos)', prefixIcon: Icon(Icons.lock_outline)),
              validator: (value) {
                final invalid = _sixDigits(value, 'O PIN');
                if (invalid != null) return invalid;
                if (RegExp(r'^(\d)\1{5}$').hasMatch(value!) || value == '123456' || value == '654321') return 'Escolha um PIN menos óbvio.';
                return null;
              },
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('activate_pin_again'),
              controller: _pinAgain,
              keyboardType: TextInputType.number,
              obscureText: true,
              inputFormatters: _digits,
              textInputAction: TextInputAction.done,
              onFieldSubmitted: (_) => _busy ? null : _submit(),
              decoration: const InputDecoration(labelText: 'Repetir PIN', prefixIcon: Icon(Icons.lock_outline)),
              validator: (value) => value == _pin.text ? null : 'Os PIN não coincidem.',
            ),
            const SizedBox(height: 16),
            _ErrorText(_error),
            FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'A ativar…' : 'Ativar e entrar')),
          ]),
        ),
      ],
    );
  }
}

class UnlockScreen extends ConsumerStatefulWidget {
  const UnlockScreen({super.key});

  @override
  ConsumerState<UnlockScreen> createState() => _UnlockScreenState();
}

class _UnlockScreenState extends ConsumerState<UnlockScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => ref.read(sessionProvider.notifier).unlock());
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(sessionProvider).user;
    return _AuthScaffold(
      title: 'Olá, ${user?.firstName ?? ''}',
      subtitle: 'A app está bloqueada. Use a impressão digital ou o rosto para continuar.',
      children: [
        FilledButton.icon(
          onPressed: () => ref.read(sessionProvider.notifier).unlock(),
          icon: const Icon(Icons.fingerprint),
          label: const Text('Desbloquear'),
        ),
        const SizedBox(height: 12),
        TextButton(onPressed: () => ref.read(sessionProvider.notifier).logout(), child: const Text('Sair e entrar com outra conta')),
      ],
    );
  }
}
