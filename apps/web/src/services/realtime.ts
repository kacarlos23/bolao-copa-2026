import { realtimeEventEnvelopeSchema, type RealtimeEventEnvelope } from '@bolao/shared';
import { API_URL } from './api-client';

export type ConnectionStatus = 'live' | 'reconnecting' | 'offline';

export interface RealtimeOptions {
  seasonId?: string;
  poolSeasonId?: string;
  eventTypes: string[];
  onEvent: (event: RealtimeEventEnvelope) => void;
  onStatus?: (status: ConnectionStatus) => void;
}

export class RealtimeClient {
  private source: EventSource | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private closed = false;
  private seen = new Set<string>();
  private onlineListener = () => this.connect();
  private offlineListener = () => this.setStatus('offline');

  constructor(private readonly options: RealtimeOptions) {}

  start() {
    this.closed = false;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onlineListener);
      window.addEventListener('offline', this.offlineListener);
    }
    this.connect();
    return this;
  }

  private setStatus(status: ConnectionStatus) {
    this.options.onStatus?.(status);
  }

  private url() {
    const query = new URLSearchParams();
    if (this.options.seasonId) query.set('seasonId', this.options.seasonId);
    if (this.options.poolSeasonId) query.set('poolSeasonId', this.options.poolSeasonId);
    const suffix = query.toString();
    return `${API_URL}/api/events${suffix ? `?${suffix}` : ''}`;
  }

  private connect() {
    if (this.closed || typeof EventSource === 'undefined') return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.setStatus('offline');
      return;
    }
    this.source?.close();
    this.setStatus(this.attempt === 0 ? 'reconnecting' : 'reconnecting');
    const source = new EventSource(this.url(), { withCredentials: true });
    this.source = source;
    source.onopen = () => {
      this.attempt = 0;
      this.setStatus('live');
    };
    for (const type of this.options.eventTypes) {
      source.addEventListener(type, (raw) => {
        try {
          const parsed = realtimeEventEnvelopeSchema.safeParse(JSON.parse((raw as MessageEvent).data));
          if (!parsed.success || parsed.data.version !== 1 || this.seen.has(parsed.data.eventId)) return;
          this.seen.add(parsed.data.eventId);
          if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value as string);
          this.options.onEvent(parsed.data);
        } catch {
          // Ignore malformed or legacy events at the client boundary.
        }
      });
    }
    source.onerror = () => {
      source.close();
      if (this.closed) return;
      this.attempt += 1;
      this.setStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'reconnecting');
      const delay = Math.min(30_000, 750 * 2 ** Math.min(this.attempt, 5)) + Math.round(Math.random() * 250);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  close() {
    this.closed = true;
    this.source?.close();
    this.source = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineListener);
      window.removeEventListener('offline', this.offlineListener);
    }
  }
}

export function createRealtimeClient(options: RealtimeOptions) {
  return new RealtimeClient(options).start();
}
