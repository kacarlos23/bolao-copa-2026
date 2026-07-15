import type { Request, Response } from 'express';

type EventPayload = Record<string, unknown>;

const MAX_CLIENTS = 100;
const HEARTBEAT_MS = 25_000;

interface ClientState {
  blocked: boolean;
  userId?: string;
  cleanup: () => void;
}

const clients = new Map<Response, ClientState>();
let heartbeat: NodeJS.Timeout | undefined;

function removeClient(res: Response) {
  const state = clients.get(res);
  if (!state) return;
  state.cleanup();
  clients.delete(res);
  if (clients.size === 0 && heartbeat) {
    clearInterval(heartbeat);
    heartbeat = undefined;
  }
}

function writeSse(res: Response, payload: string) {
  const state = clients.get(res);
  if (state?.blocked || res.writableEnded || res.destroyed) return;
  const accepted = res.write(payload);
  (res as Response & { flush?: () => void }).flush?.();
  if (!accepted && state) {
    state.blocked = true;
    res.once('drain', () => {
      const current = clients.get(res);
      if (current) current.blocked = false;
    });
  }
}

function ensureHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    for (const client of clients.keys()) writeSse(client, ': heartbeat\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
}

export function addSseClient(res: Response, req?: Request) {
  if (clients.size >= MAX_CLIENTS) {
    res.status(503).end();
    return false;
  }

  const cleanup = () => {
    res.off('close', onClose);
    res.off('error', onClose);
    req?.off('aborted', onClose);
  };
  const onClose = () => removeClient(res);
  clients.set(res, { blocked: false, userId: req?.session.user?.id, cleanup });
  res.once('close', onClose);
  res.once('error', onClose);
  req?.once('aborted', onClose);
  ensureHeartbeat();
  writeSse(res, ': connected\n\n');
  return true;
}

export function emitSse(event: string, data: EventPayload) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients.keys()) {
    writeSse(client, payload);
  }
}

export function closeAllSseClients() {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = undefined;
  }
  for (const client of [...clients.keys()]) {
    removeClient(client);
    if (!client.writableEnded) client.end();
  }
}

export function closeSseClientsForUser(userId: string) {
  for (const [client, state] of [...clients.entries()]) {
    if (state.userId !== userId) continue;
    removeClient(client);
    if (!client.writableEnded) client.end();
  }
}

export function activeSseClientCount() {
  return clients.size;
}
