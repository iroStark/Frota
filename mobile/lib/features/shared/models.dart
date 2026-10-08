import '../../core/format/format.dart';

DateTime? _date(Object? value) => value == null ? null : DateTime.parse('$value');
List<Map<String, dynamic>> _list(Object? value) => (value as List? ?? const []).map((item) => Map<String, dynamic>.from(item as Map)).toList();

class AlertItem {
  AlertItem.fromJson(Map<String, dynamic> json)
      : severity = json['severity'] as String,
        kind = json['kind'] as String,
        title = json['title'] as String,
        detail = json['detail'] as String,
        targetType = (json['target'] as Map?)?['type'] as String?,
        targetId = (json['target'] as Map?)?['id'] as String?;

  final String severity;
  final String kind;
  final String title;
  final String detail;
  final String? targetType;
  final String? targetId;
}

class WeekCharge {
  WeekCharge.fromJson(Map<String, dynamic> json)
      : id = json['id'] as String,
        driverId = json['driver_id'] as String,
        driverName = json['driver_name'] as String,
        amount = asInt(json['amount']),
        paid = asInt(json['paid']),
        status = json['status'] as String,
        dueAt = DateTime.parse(json['due_at'] as String);

  final String id;
  final String driverId;
  final String driverName;
  final int amount;
  final int paid;
  final String status;
  final DateTime dueAt;

  int get outstanding => amount - paid;
}

class Dashboard {
  Dashboard.fromJson(Map<String, dynamic> json)
      : periodStart = json['billingWeek']['periodStart'] as String,
        dueAt = DateTime.parse(json['billingWeek']['dueAt'] as String),
        expected = asInt(json['billingWeek']['expected']),
        paid = asInt(json['billingWeek']['paid']),
        outstanding = asInt(json['billingWeek']['outstanding']),
        progress = asInt(json['billingWeek']['progress']),
        weekCharges = _list(json['billingWeek']['charges']).map(WeekCharge.fromJson).toList(),
        debtTotal = asInt(json['debt']['total']),
        debtDrivers = asInt(json['debt']['drivers']),
        declarationsToReview = asInt(json['toReview']['declarations']),
        incidentsToReview = asInt(json['toReview']['incidents']),
        vehicles = Map<String, int>.from((json['vehicles'] as Map).map((key, value) => MapEntry('$key', asInt(value)))),
        monthReceived = asInt(json['month']['received']),
        monthExpenses = asInt(json['month']['ownerExpenses']),
        monthNet = asInt(json['month']['net']),
        alerts = _list(json['alerts']).map(AlertItem.fromJson).toList();

  final String periodStart;
  final DateTime dueAt;
  final int expected;
  final int paid;
  final int outstanding;
  final int progress;
  final List<WeekCharge> weekCharges;
  final int debtTotal;
  final int debtDrivers;
  final int declarationsToReview;
  final int incidentsToReview;
  final Map<String, int> vehicles;
  final int monthReceived;
  final int monthExpenses;
  final int monthNet;
  final List<AlertItem> alerts;
}

class ChargeCalculation {
  ChargeCalculation.fromJson(Map<String, dynamic> json)
      : chargedDays = asInt(json['chargedDays']),
        workingDays = asInt(json['workingDays']),
        dailyRate = asInt(json['dailyRate']),
        weeklyFee = asInt(json['weeklyFee']),
        stoppedDays = (json['stoppedDays'] as List? ?? const []).map((day) => '$day').toList();

  final int chargedDays;
  final int workingDays;
  final int dailyRate;
  final int weeklyFee;
  final List<String> stoppedDays;

  /// "4 de 6 dias · 2 dias parados" — explica o valor ao motorista.
  String get summary {
    final base = chargedDays == workingDays ? 'Semana completa' : '$chargedDays de $workingDays dias';
    return stoppedDays.isEmpty ? base : '$base · ${stoppedDays.length} dia(s) parado(s)';
  }
}

const chargeKindLabels = {
  'semanal': 'Entrega semanal',
  'penalidade_atraso': 'Penalidade de atraso',
  'multa_fora_horario': 'Multa fora de horário',
  'multa_nao_restituicao': 'Multa por não restituição',
  'franquia_sinistro': 'Franquia de sinistro',
  'multa_conduta': 'Multa de conduta',
  'ajuste': 'Ajuste',
  'credito': 'Crédito',
};

class StatementCharge {
  StatementCharge.fromJson(Map<String, dynamic> json)
      : id = json['id'] as String,
        kind = json['kind'] as String,
        periodStart = json['period_start'] as String?,
        dueAt = DateTime.parse(json['due_at'] as String),
        amount = asInt(json['amount']),
        paid = asInt(json['paid']),
        status = json['status'] as String,
        description = json['description'] as String?,
        calculation = json['calculation'] is Map ? ChargeCalculation.fromJson(Map<String, dynamic>.from(json['calculation'] as Map)) : null;

  final String id;
  final String kind;
  final String? periodStart;
  final DateTime dueAt;
  final int amount;
  final int paid;
  final String status;
  final String? description;
  final ChargeCalculation? calculation;

  int get outstanding => amount - paid;
  String get title => kind == 'semanal' && periodStart != null ? 'Semana ${formatWeek(periodStart!)}' : chargeKindLabels[kind] ?? kind;
}

class StatementPayment {
  StatementPayment.fromJson(Map<String, dynamic> json)
      : id = json['id'] as String,
        amount = asInt(json['amount']),
        receivedAt = DateTime.parse(json['received_at'] as String),
        method = json['method'] as String,
        reference = json['reference'] as String?;

  final String id;
  final int amount;
  final DateTime receivedAt;
  final String method;
  final String? reference;
}

class Statement {
  Statement.fromJson(Map<String, dynamic> json)
      : balance = asInt(json['totals']['balance']),
        overdue = asInt(json['totals']['overdue']),
        charged = asInt(json['totals']['charged']),
        paid = asInt(json['totals']['paid']),
        charges = _list(json['charges']).map(StatementCharge.fromJson).toList(),
        payments = _list(json['payments']).map(StatementPayment.fromJson).toList();

  final int balance;
  final int overdue;
  final int charged;
  final int paid;
  final List<StatementCharge> charges;
  final List<StatementPayment> payments;
}

class DriverHome {
  DriverHome.fromJson(Map<String, dynamic> json)
      : balance = asInt(json['balance']),
        overdue = asInt(json['overdue']),
        nextDue = json['nextDue'] == null ? null : NextDue.fromJson(Map<String, dynamic>.from(json['nextDue'] as Map)),
        vehicle = json['vehicle'] == null ? null : Map<String, dynamic>.from(json['vehicle'] as Map),
        documents = _list(json['documents']),
        declarations = _list(json['declarations']),
        openIncidents = _list(json['openIncidents']);

  final int balance;
  final int overdue;
  final NextDue? nextDue;
  final Map<String, dynamic>? vehicle;
  final List<Map<String, dynamic>> documents;
  final List<Map<String, dynamic>> declarations;
  final List<Map<String, dynamic>> openIncidents;
}

class NextDue {
  NextDue.fromJson(Map<String, dynamic> json)
      : periodStart = json['periodStart'] as String,
        dueAt = DateTime.parse(json['dueAt'] as String),
        estimatedAmount = asInt(json['estimatedAmount']),
        chargedDays = asInt(json['chargedDays']),
        stoppedDays = (json['stoppedDays'] as List? ?? const []).length;

  final String periodStart;
  final DateTime dueAt;
  final int estimatedAmount;
  final int chargedDays;
  final int stoppedDays;
}

DateTime? parseDate(Object? value) => _date(value);
