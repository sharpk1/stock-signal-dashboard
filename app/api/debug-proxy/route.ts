import { NextResponse } from 'next/server';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { YoutubeTranscript } from 'youtube-transcript';

// TEMPORARY diagnostic — remove after debugging transcript proxying.
export async function GET() {
  const u = process.env.WEBSHARE_PROXY_USERNAME;
  const p = process.env.WEBSHARE_PROXY_PASSWORD;
  const host = process.env.WEBSHARE_PROXY_HOST ?? 'p.webshare.io';
  const port = process.env.WEBSHARE_PROXY_PORT ?? '80';

  const makeProxyFetch = () => {
    const dispatcher = new ProxyAgent(`http://${u}:${p}@${host}:${port}`);
    return ((input: string, init?: object) =>
      undiciFetch(input, { ...init, dispatcher })) as unknown as typeof fetch;
  };

  // Try to fetch a known-good transcript up to 6 times; each attempt = new rotating IP.
  const videoId = '9JrC-af9L5A';
  const attempts: string[] = [];
  let succeeded = false;
  for (let i = 0; i < 6 && !succeeded; i++) {
    const fetchFn = makeProxyFetch();
    let ip = '?';
    try {
      ip = (await (await undiciFetch('https://ipv4.webshare.io/', { dispatcher: new ProxyAgent(`http://${u}:${p}@${host}:${port}`) })).text()).trim();
    } catch { /* ignore */ }
    try {
      const t = await YoutubeTranscript.fetchTranscript(videoId, { fetch: fetchFn });
      attempts.push(`#${i + 1} ip=${ip} OK len=${t.length}`);
      succeeded = true;
    } catch (e) {
      attempts.push(`#${i + 1} ip=${ip} FAIL: ${(e as Error).message.slice(0, 50)}`);
    }
  }

  return NextResponse.json({ videoId, succeeded, attempts });
}
