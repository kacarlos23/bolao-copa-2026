import type { Response } from 'express';

type EventPayload = Record<string, unknown>;

const clients = new Set<Response>();

function writeSse(res: Response, payload: string) {
  res.write(payload);
  (res as Response & { flush?: () => void }).flush?.();
}

export function addSseClient(res: Response) {
  clients.add(res);
  writeSse(res, ': connected\n\n');

  const heartbeat = setInterval(() => {
    writeSse(res, ': heartbeat\n\n');
  }, 25_000);

  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}

export function emitSse(event: string, data: EventPayload) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    writeSse(client, payload);
  }
}
