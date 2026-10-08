import 'package:flutter/material.dart';

/// Identidade UHOCHA (a mesma do PWA): grafite + verde-lima.
class Brand {
  static const lime = Color(0xFFC9F158);
  static const graphite = Color(0xFF202020);
  static const surfaceLight = Color(0xFFF2F3F5);
  static const ok = Color(0xFF5E9E00);
  static const warn = Color(0xFFB7791F);
  static const danger = Color(0xFFB3261E);
}

ThemeData buildTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: Brand.lime,
    brightness: brightness,
    primary: dark ? Brand.lime : Brand.graphite,
    onPrimary: dark ? Brand.graphite : Colors.white,
    secondary: Brand.lime,
    onSecondary: Brand.graphite,
    surface: dark ? const Color(0xFF1B1B1B) : Brand.surfaceLight,
    error: Brand.danger,
  );
  const radius = BorderRadius.all(Radius.circular(16));
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      foregroundColor: scheme.onSurface,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: scheme.onSurface),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      margin: EdgeInsets.zero,
      color: dark ? const Color(0xFF2A2A2A) : Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(20))),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: dark ? const Color(0xFF2A2A2A) : Colors.white,
      border: const OutlineInputBorder(borderRadius: radius, borderSide: BorderSide.none),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        shape: const RoundedRectangleBorder(borderRadius: radius),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      indicatorColor: Brand.lime,
      backgroundColor: dark ? const Color(0xFF2A2A2A) : Colors.white,
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(color: states.contains(WidgetState.selected) ? Brand.graphite : scheme.onSurfaceVariant),
      ),
    ),
    chipTheme: const ChipThemeData(shape: StadiumBorder(), side: BorderSide.none),
  );
}
