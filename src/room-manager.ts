import { randomUUID } from 'node:crypto';
import Client from './client';
import { Room, RoomOptions, User, DEFAULT_PLAYER } from './schemas';
import logger from './logger';

const ROOM_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

class RoomManager {

    #rooms = new Map<string, Room>();

    get roomCount() {
        return this.#rooms.size;
    }

    public get(room_id: string): Room | undefined {
        return this.#rooms.get(room_id);
    }

    public getClientRoom(client: Client): Room | null {
        if (!client.room_id) return null;
        return this.#rooms.get(client.room_id) || null;
    }

    public create(client: Client, options: RoomOptions): { room: Room; leftRoomId?: string } {
        const leftRoomId = client.room_id || undefined;
        if (client.room_id) {
            this.leave(client);
        }

        const room: Room = {
            id: randomUUID(),
            stream: structuredClone(options.stream),
            meta: structuredClone(options.meta),
            player: structuredClone(DEFAULT_PLAYER),
            users: [client.toUser()],
            owner: client.id,
            lastActivity: Date.now(),
        };

        client.room_id = room.id;
        this.#rooms.set(room.id, room);
        return { room, leftRoomId };
    }

    public join(client: Client, room_id: string): { room: Room; leftRoomId?: string } | null {
        const room = this.#rooms.get(room_id);
        if (!room) return null;

        const leftRoomId = (client.room_id && client.room_id !== room_id) ? client.room_id : undefined;
        if (leftRoomId) {
            this.leave(client);
        }

        client.room_id = room.id;
        // Deduplicate: remove then re-add
        room.users = [
            ...room.users.filter(({ id }) => id !== client.id),
            client.toUser()
        ];

        return { room, leftRoomId };
    }

    public leave(client: Client): Room | undefined {
        if (!client.room_id) return;

        const room = this.#rooms.get(client.room_id);
        if (!room) {
            client.room_id = '';
            return;
        }

        room.users = room.users.filter(({ id }) => id !== client.id);
        client.room_id = '';

        if (room.owner === client.id && room.users.length > 0) {
            room.owner = room.users[0].id;
        }

        if (room.users.length === 0) {
            this.#rooms.delete(room.id);
            logger.debug({ roomId: room.id }, 'Empty room removed');
        }

        return room;
    }

    public updateUser(room_id: string, user: User): Room | null {
        const room = this.#rooms.get(room_id);
        if (!room) return null;

        room.users = room.users.map(room_user =>
            room_user.id === user.id ? user : room_user
        );

        return room;
    }

    public updateOwner(room_id: string, user: User): Room | null {
        const room = this.#rooms.get(room_id);
        if (!room) return null;

        room.owner = user.id;

        return room;
    }

    public touchRoom(room_id: string) {
        const room = this.#rooms.get(room_id);
        if (room) room.lastActivity = Date.now();
    }

    public expireInactiveRooms(): string[] {
        const now = Date.now();
        const expired: string[] = [];

        for (const [roomId, room] of this.#rooms) {
            if (now - room.lastActivity > ROOM_EXPIRY_MS) {
                this.#rooms.delete(roomId);
                expired.push(roomId);
                logger.debug({ roomId }, 'Room expired due to inactivity');
            }
        }

        return expired;
    }

    public cleanupDisconnectedUsers(activeClientIds: Set<string>): Room[] {
        const changedRooms: Room[] = [];

        for (const [roomId, room] of this.#rooms) {
            const prevLength = room.users.length;
            room.users = room.users.filter(user => activeClientIds.has(user.id));

            if (room.users.length !== prevLength) {
                if (!activeClientIds.has(room.owner) && room.users.length > 0) {
                    room.owner = room.users[0].id;
                }
                changedRooms.push(room);
            }

            if (room.users.length === 0) {
                this.#rooms.delete(roomId);
            }
        }

        return changedRooms;
    }
}

export default RoomManager;
