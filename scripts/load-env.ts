/**
 * Loads `.env.local` then `.env` for the pnpm scripts, mirroring Next.js
 * precedence (`.env.local` wins). Import first in every script.
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });
