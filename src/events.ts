import type Client from './client';
import type { Meta, Stream, Player, User, Room } from './schemas';
import type { z } from 'zod';
import type { ClientUpdateStreamSchema } from './schemas';

// --- Server → Client events ---

export type ServerEvent = {
    type: string;
    payload: object;
};

export class ReadyEvent implements ServerEvent {
    type = 'ready';
    payload: { user: User };

    constructor(user: User) {
        this.payload = { user };
    }
}

export class UserEvent implements ServerEvent {
    type = 'user';
    payload: { user: User };

    constructor(user: User) {
        this.payload = { user };
    }
}

export class RoomEvent implements ServerEvent {
    type = 'room';
    payload: Room;

    constructor(room: Room) {
        this.payload = room;
    }
}

export class SyncEvent extends RoomEvent {
    type = 'sync';
}

export class MessageEvent implements ServerEvent {
    type = 'message';
    payload: {
        user: string;
        content: string;
        date: number;
    };

    constructor(sender: Client, content: string) {
        this.payload = {
            user: sender.id,
            content: content.substring(0, 300),
            date: Date.now(),
        };
    }
}

export class ErrorEvent implements ServerEvent {
    type = 'error';
    payload: { type: string };

    constructor(type: string) {
        this.payload = { type };
    }
}

// --- Client → Server event types ---

export type ClientEvent = {
    client: Client;
    payload: object;
};

export interface ClientUserUpdate extends ClientEvent {
    payload: { username: string };
}

export interface ClientNewRoom extends ClientEvent {
    payload: { meta: Meta; stream: Stream };
}

export interface ClientJoinRoom extends ClientEvent {
    payload: { id: string };
}

export interface ClientMessage extends ClientEvent {
    payload: { content: string };
}

export interface ClientUpdateOwnership extends ClientEvent {
    payload: { userId: string };
}

export interface ClientSync extends ClientEvent {
    payload: Player;
}

export interface ClientLeaveRoom extends ClientEvent {
    payload: Record<string, never>;
}

export interface ClientUpdateStream extends ClientEvent {
    payload: z.infer<typeof ClientUpdateStreamSchema>;
}

// --- Typed event map ---

export interface ServerEventMap {
    'user.update': (event: ClientUserUpdate) => void;
    'room.new': (event: ClientNewRoom) => void;
    'room.join': (event: ClientJoinRoom) => void;
    'room.leave': (event: ClientLeaveRoom) => void;
    'room.message': (event: ClientMessage) => void;
    'room.updateOwnership': (event: ClientUpdateOwnership) => void;
    'room.updateStream': (event: ClientUpdateStream) => void;
    'player.sync': (event: ClientSync) => void;
    'client.disconnect': (event: { client: Client }) => void;
}
