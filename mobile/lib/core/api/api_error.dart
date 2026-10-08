import 'package:dio/dio.dart';

/// Erro da API já traduzido para mostrar ao utilizador.
class ApiException implements Exception {
  ApiException(this.message, {this.status, this.code, this.fieldErrors = const {}});

  final String message;
  final int? status;
  final String? code;
  final Map<String, List<String>> fieldErrors;

  bool get isOffline => status == null;
  bool get isUnauthorized => status == 401;

  factory ApiException.fromDio(DioException error) {
    final response = error.response;
    if (response == null) {
      return ApiException('Sem ligação ao servidor. Verifique a internet e tente novamente.');
    }
    final data = response.data;
    if (data is Map) {
      final details = data['details'];
      final fields = <String, List<String>>{};
      if (details is Map && details['fieldErrors'] is Map) {
        (details['fieldErrors'] as Map).forEach((key, value) {
          if (value is List) fields['$key'] = value.map((item) => '$item').toList();
        });
      }
      return ApiException(
        '${data['error'] ?? 'Ocorreu um erro (${response.statusCode}).'}',
        status: response.statusCode,
        code: data['code'] as String?,
        fieldErrors: fields,
      );
    }
    return ApiException('Ocorreu um erro (${response.statusCode}).', status: response.statusCode);
  }

  @override
  String toString() => message;
}
