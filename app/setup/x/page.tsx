import type { Metadata } from 'next';
import { getDb } from '@/lib/db';
import { checkSetupKey } from '@/lib/setup-links';
import { XSetupForm, SetupShell } from './XSetupForm';

export const metadata: Metadata = { title: 'Connect X · Stock Signals' };

// /setup/x?key=… — Ray's one-time page for connecting X (RAY-16). The key in
// the link is the only credential, so this page sits outside the app password
// and refuses anything but a live, unused link.
export default async function SetupXPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const raw = (await searchParams).key;
  const key = typeof raw === 'string' ? raw : undefined;
  const link = await checkSetupKey(await getDb(), key);

  if (!link.ok) {
    return (
      <SetupShell>
        <section className="bg-white border border-gray-200 rounded-[14px] p-[22px] flex flex-col gap-2">
          <h1 className="text-lg font-semibold">This link can&apos;t be used</h1>
          <p className="text-[15px] text-gray-600 leading-relaxed">{link.message}</p>
        </section>
      </SetupShell>
    );
  }

  const expires = new Date(link.expiresAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'America/Denver',
  });
  return <XSetupForm setupKey={key!} expires={expires} />;
}
