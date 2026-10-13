# Temporary diagnostics in 2.0

npm run diagnostics:on enables plugin tracing after a complete restart. npm run diagnostics:off removes the marker and requires a restart to remove the active method observers. Logs stay private under ignored recovery/drop-trace.jsonl and are retained when disabled.

The failed main-process remote.require observer and its loader/test were retired during the source migration. Existing tabby-runtime*.jsonl and Tabby's main-process-errors.log may be retained as historical evidence, but the new source does not treat that failed observer as live telemetry.

Once acceptance passes, disable tracing. To remove it from source, remove the drop-diagnostics registration from src/features/bootstrap.ts, remove its module/diagnostic-only fixture and policy, and remove the optional trace calls/properties through a checked refactor. Keep sync-context.cjs, new-file.cjs, metadata/permission helpers, safety guards, keyboard handling and transfer logic; these are permanent fixes.

Do not delete edit/transfer journals, partial data or staged uploads when clearing logs. See docs/ARCHITECTURE.md and docs/REWRITE-ACCEPTANCE.md.
