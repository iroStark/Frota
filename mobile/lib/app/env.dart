/// Configuração de compilação: `flutter run --dart-define=API_URL=https://...`.
/// Por omissão aponta para o backend local (no emulador Android use http://10.0.2.2:3000).
class Env {
  static const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:3000');
  static const apiBase = '$apiUrl/api/v1';
}
