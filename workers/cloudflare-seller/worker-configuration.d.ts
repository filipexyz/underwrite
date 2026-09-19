/**
 * Bindings for this worker. Re-run `pnpm types` (`wrangler types`) after
 * changing wrangler.jsonc; keep these names in sync.
 */
interface Env {
  SellerAgent: DurableObjectNamespace<import("./src/seller-agent").SellerAgent>;
  UNDERWRITE_BASE_URL: string;
  UNDERWRITE_SELLER_API_KEY: string;
  UNDERWRITE_WEBHOOK_SECRET: string;
  NEURALAKE_API_KEY: string;
  NEURALAKE_BASE_URL?: string;
  NEURALAKE_MODEL?: string;
  SELLER_INSTANCE_NAME?: string;
}
