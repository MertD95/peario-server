import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { ServerEvent } from './events';
import type { User } from './schemas';
import logger from './logger';

class Client {
    public id: string;
    public name: string;
    public room_id: string = '';
    public cooldown: number;
    public isAlive: boolean = true;

    #socket: WebSocket;

    constructor(socket: WebSocket) {
        this.id = randomUUID();
        this.name = `Guest${this.id.slice(0, 4)}`;
        this.#socket = socket;
        this.cooldown = Date.now();
    }

    onMessage(callback: (data: string) => void) {
        this.#socket.on('message', callback);
    }

    onClose(callback: () => void) {
        let called = false;
        const once = () => {
            if (called) return;
            called = true;
            callback();
        };
        this.#socket.on('close', once);
        this.#socket.on('error', once);
    }

    onPong(callback: () => void) {
        this.#socket.on('pong', callback);
    }

    ping() {
        if (this.#socket.readyState === WebSocket.OPEN) {
            this.#socket.ping();
        }
    }

    sendEvent({ type, payload }: ServerEvent) {
        if (this.#socket.readyState !== WebSocket.OPEN) return;
        try {
            this.#socket.send(JSON.stringify({ type, payload }));
        } catch (e) {
            logger.warn({ client: this.name, error: e }, 'Failed to send event');
        }
    }

    terminate() {
        this.#socket.terminate();
    }

    resetCooldown() {
        this.cooldown = Date.now();
    }

    toUser(): User {
        return {
            id: this.id,
            name: this.name,
            room_id: this.room_id,
        };
    }
}

export default Client;
