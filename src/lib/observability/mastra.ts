/**
 * Mastra observability, gated by environment.
 *
 * - `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` → traces export to Langfuse.
 * - `MASTRA_OBSERVABILITY_CONSOLE=1` → spans print to stdout (local debugging).
 * - Nothing set → `undefined`, and Mastra runs with its built-in no-op tracer.
 *
 * The ledger is the product's audit trail regardless; this is the tracing layer
 * on top of it (token/cost spans per workflow step and model call).
 */
import type { ObservabilityExporter } from "@mastra/core/observability";
import { ConsoleExporter, Observability } from "@mastra/observability";
import { LangfuseExporter } from "@mastra/langfuse";
import { env } from "@/lib/env";

export type ObservabilityStatus = {
  langfuse: boolean;
  console: boolean;
  enabled: boolean;
};

export function observabilityStatus(): ObservabilityStatus {
  const langfuse = env.langfuse.enabled;
  const console = env.observability.console;
  return { langfuse, console, enabled: langfuse || console };
}

export function createObservability(): Observability | undefined {
  const status = observabilityStatus();
  if (!status.enabled) return undefined;

  const exporters: ObservabilityExporter[] = [];
  if (status.langfuse) {
    exporters.push(
      new LangfuseExporter({
        publicKey: env.langfuse.publicKey,
        secretKey: env.langfuse.secretKey,
        baseUrl: env.langfuse.baseUrl,
        environment: env.nodeEnv,
        realtime: env.nodeEnv !== "production",
      }),
    );
  }
  if (status.console) exporters.push(new ConsoleExporter());

  return new Observability({
    configs: {
      default: {
        serviceName: env.observability.serviceName,
        exporters,
      },
    },
  });
}
