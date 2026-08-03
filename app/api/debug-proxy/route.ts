import { NextResponse } from 'next/server';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

// TEMPORARY diagnostic — remove after debugging transcript proxying.
export async function GET() {
  const u = process.env.WEBSHARE_PROXY_USERNAME;
  const p = process.env.WEBSHARE_PROXY_PASSWORD;
  const host = process.env.WEBSHARE_PROXY_HOST ?? 'p.webshare.io';
  const port = process.env.WEBSHARE_PROXY_PORT ?? '80';

  const out: Record<string, unknown> = {
    userLen: u?.length ?? null,
    passLen: p?.length ?? null,
    hostRaw: JSON.stringify(host),
    portRaw: JSON.stringify(port),
    hasWhitespace: {
      user: u ? /\s/.test(u) : null,
      pass: p ? /\s/.test(p) : null,
    },
  };

  // direct exit IP (Vercel's egress)
  try {
    const r = await fetch('https://ipv4.webshare.io/', { cache: 'no-store' });
    out.directIp = (await r.text()).trim();
  } catch (e) {
    out.directIp = `ERR: ${(e as Error).message}`;
  }

  // proxied exit IP via undici dispatcher (same mechanism as lib/youtube.ts)
  try {
    const dispatcher = new ProxyAgent(`http://${u}:${p}@${host}:${port}`);
    const r = await undiciFetch('https://ipv4.webshare.io/', { dispatcher });
    out.proxiedIp = (await r.text()).trim();
  } catch (e) {
    out.proxiedIp = `ERR: ${(e as Error).message}`;
  }

  return NextResponse.json(out);
}
