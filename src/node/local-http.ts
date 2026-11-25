import type { IncomingMessage, ServerResponse } from 'node:http';

// Browser-origin boundary, not authentication against other local processes.
export function allowLocalRequest(
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  const host = request.headers.host ?? '';
  const origin = request.headers.origin;
  const site = request.headers['sec-fetch-site'];
  if (
    !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) ||
    (origin !== undefined && origin !== `http://${host}`) ||
    (site !== undefined && site !== 'same-origin' && site !== 'none')
  ) {
    response.writeHead(403).end();
    return false;
  }
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  return true;
}

export function hasJsonContentType(request: IncomingMessage): boolean {
  return (
    request.headers['content-type']?.split(';')[0].trim().toLowerCase() ===
    'application/json'
  );
}

export async function readRequestBody(
  request: IncomingMessage,
  response: ServerResponse,
  limit: number,
): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > limit) {
      response.writeHead(413).end();
      return undefined;
    }
    chunks.push(buffer);
  }
  // Decode only after concatenation: a UTF-8 character can span transport chunks.
  return Buffer.concat(chunks).toString('utf8');
}
