// Mints Ray's one-time /setup/x link (RAY-16) and prints it. Only the key's
// SHA-256 goes into the database; the printed URL is the only copy of the key,
// so send it straight to Ray. It expires in 7 days and dies once he saves.
//
// Runs on Kush's Mac against production Turso:
//
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx scripts/create-x-setup-link.ts
//
// Refuses to run without TURSO_DATABASE_URL, so it can't quietly write a link
// into the tracked data/signals.db instead.
import { getDb } from '@/lib/db';
import { createSetupLink, setupUrl } from '@/lib/setup-links';

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error('Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN) to the production database first.');
    process.exit(1);
  }
  const db = await getDb();
  const { key, expiresAt } = await createSetupLink(db);
  console.log(`Setup link for Ray (expires ${expiresAt}):\n\n${setupUrl(key)}\n`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
