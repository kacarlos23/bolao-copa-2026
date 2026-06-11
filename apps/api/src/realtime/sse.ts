import type { Response } from 'express';

type EventPayload = Record<string, unknown>;

const clients = new Set<Response>();

export function addSseClient(res: Response) {
  clients.add(res);
  res.write(': connected\n\n');

  res.on('close', () => {
    clients.delete(res);
  });
}

export function emitSse(event: string, data: EventPayload) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}
