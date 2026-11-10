// OpenZCAD exposes warnings, not a `derived.diagnostics` property.
// Preserve native classifications when available; do not guess severity from text.
export function cadDiagnostics(derived = {}) {
  const tagged = derived.featureWarnings || [];
  const messages = new Set(tagged.map(warning => warning.message));
  return [
    ...tagged.map(warning => ({
      ...warning,
      severity: ['build-failed', 'refusal'].includes(warning.kind) ? 'error' : 'warning',
    })),
    ...(derived.warnings || []).filter(message => !messages.has(message))
      .map(message => ({severity: 'warning', message})),
  ];
}
