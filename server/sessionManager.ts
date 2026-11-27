import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import type { SecureChannel } from './crypto.js';

export interface ActiveSession {
  id: string;
  channel: SecureChannel;
  ws: WebSocket;
}

export class SessionManager {
  private readonly sessions = new Map<string, ActiveSession>();

  add(channel: SecureChannel, ws: WebSocket): string {
    const id = crypto.randomUUID();
    this.sessions.set(id, { id, channel, ws });
    return id;
  }

  get(id: string): ActiveSession | undefined {
    return this.sessions.get(id);
  }

  remove(id: string): boolean {
    return this.sessions.delete(id);
  }

  broadcast(message: unknown): void {
    for (const session of this.sessions.values()) {
      if (session.channel.isEncrypted && session.ws.readyState === session.ws.OPEN) {
        try {
          session.channel.sendFrame(session.ws, message);
        } catch {
          // ignore closed sockets
        }
      }
    }
  }

  get count(): number {
    return this.sessions.size;
  }
}
