// Retired: never read map credentials or forward any upstream request.
Deno.serve(() => new Response('Map service has been disabled.', {
  status: 410,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
}));
