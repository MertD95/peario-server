import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import Client from './client';
import { ServerEvent, ReadyEvent, ErrorEvent } from './events';
import type { ServerEventMap } from './events';
import { EventSchema } from './schemas';
import logger from './logger';
import { MAX_CONNECTIONS, MAX_CONNECTIONS_PER_IP, PING_INTERVAL } from './config';

const MAX_PAYLOAD = 64 * 1024; // 64 KB

class WS {

    #wss: WebSocketServer;
    #pingInterval: ReturnType<typeof setInterval>;
    #ipConnections = new Map<string, number>();
    #clientsById = new Map<string, Client>();
    #clientsByRoom = new Map<string, Set<string>>();
    public events = new EventEmitter as unknown as TypedEmitter<ServerEventMap>;

    get clientCount() {
        return this.#clientsById.size;
    }

    get allClientIds(): Set<string> {
        return new Set(this.#clientsById.keys());
    }

    constructor(server: http.Server) {
        this.#wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD });

        this.#wss.on('connection', (socket: WebSocket, req: http.IncomingMessage) => {
            const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
                || req.socket.remoteAddress
                || 'unknown';

            // Connection limits
            if (this.#clientsById.size >= MAX_CONNECTIONS) {
                logger.warn({ ip }, 'Max connections reached, rejecting');
                socket.close(1013, 'Max connections reached');
                return;
            }

            const ipCount = this.#ipConnections.get(ip) || 0;
            if (ipCount >= MAX_CONNECTIONS_PER_IP) {
                logger.warn({ ip, count: ipCount }, 'Per-IP connection limit reached');
                socket.close(1013, 'Too many connections from this IP');
                return;
            }
            this.#ipConnections.set(ip, ipCount + 1);

            const client = new Client(socket);
            client.sendEvent(new ReadyEvent(client.toUser()));
            client.onMessage((data: string) => this.#handleEvents(client, data));

            client.onPong(() => {
                client.isAlive = true;
            });

            client.onClose(() => {
                this.#removeClient(client);
                const currentIpCount = this.#ipConnections.get(ip) || 1;
                if (currentIpCount <= 1) {
                    this.#ipConnections.delete(ip);
                } else {
                    this.#ipConnections.set(ip, currentIpCount - 1);
                }
                this.events.emit('client.disconnect', { client });
                logger.info({ id: client.id, name: client.name }, 'Client disconnected');
            });

            this.#clientsById.set(client.id, client);
            logger.info({ id: client.id, name: client.name, ip }, 'New client connected');
        });

        // WebSocket ping/pong for dead connection detection
        this.#pingInterval = setInterval(() => {
            for (const client of this.#clientsById.values()) {
                if (!client.isAlive) {
                    logger.debug({ id: client.id, name: client.name }, 'Client failed ping, terminating');
                    client.terminate();
                    continue;
                }
                client.isAlive = false;
                client.ping();
            }
        }, PING_INTERVAL);
    }

    #handleEvents(client: Client, data: string) {
        try {
            const parsed = JSON.parse(data);
            const validation = EventSchema.safeParse(parsed);

            if (!validation.success) {
                logger.warn({
                    client: client.name,
                    errors: validation.error.issues,
                    type: parsed?.type,
                }, 'Validation failed for incoming event');
                client.sendEvent(new ErrorEvent('validation'));
                return;
            }

            const { type, payload } = validation.data;
            this.events.emit(type as keyof ServerEventMap, { client, payload } as any);
            logger.debug({ client: client.name, type }, 'Received event');
        } catch (e) {
            logger.error({ client: client.name, error: e }, 'Error while parsing event');
            client.sendEvent(new ErrorEvent('parse'));
        }
    }

    #removeClient(client: Client) {
        this.#clientsById.delete(client.id);
        if (client.room_id) {
            this.removeClientFromRoom(client.id, client.room_id);
        }
    }

    // --- Room index management ---

    public addClientToRoom(clientId: string, roomId: string) {
        let roomSet = this.#clientsByRoom.get(roomId);
        if (!roomSet) {
            roomSet = new Set();
            this.#clientsByRoom.set(roomId, roomSet);
        }
        roomSet.add(clientId);
    }

    public removeClientFromRoom(clientId: string, roomId: string) {
        const roomSet = this.#clientsByRoom.get(roomId);
        if (roomSet) {
            roomSet.delete(clientId);
            if (roomSet.size === 0) {
                this.#clientsByRoom.delete(roomId);
            }
        }
    }

    public deleteRoom(roomId: string) {
        this.#clientsByRoom.delete(roomId);
    }

    // --- Messaging ---

    public getClientsByRoomId(room_id: string): Client[] {
        const roomSet = this.#clientsByRoom.get(room_id);
        if (!roomSet) return [];

        const clients: Client[] = [];
        for (const clientId of roomSet) {
            const client = this.#clientsById.get(clientId);
            if (client) clients.push(client);
        }
        return clients;
    }

    public sendToClients(clients: Client[], event: ServerEvent) {
        for (const c of clients) {
            c.sendEvent(event);
        }
    }

    public sendToRoomClients(room_id: string, event: ServerEvent) {
        const clients = this.getClientsByRoomId(room_id);
        this.sendToClients(clients, event);
    }

    public close() {
        clearInterval(this.#pingInterval);
        for (const client of this.#clientsById.values()) {
            client.terminate();
        }
        this.#clientsById.clear();
        this.#clientsByRoom.clear();
        this.#ipConnections.clear();
        this.#wss.close();
    }
}

// Typed EventEmitter helper
interface TypedEmitter<T> {
    on<K extends keyof T & string>(event: K, listener: T[K]): this;
    emit<K extends keyof T & string>(event: K, ...args: T[K] extends (...args: infer A) => void ? A : never): boolean;
    removeAllListeners(event?: string): this;
}

export default WS;
