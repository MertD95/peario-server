import { describe, it, expect, vi } from 'vitest';
import RoomManager from '../src/room-manager';
import Client from '../src/client';
import WebSocket from 'ws';

vi.mock('ws');

describe('RoomManager', () => {
    const mockSocket = new WebSocket('ws://localhost') as any;

    function makeClient() {
        return new Client(mockSocket);
    }

    const options = {
        meta: { id: 'm1', type: 'movie', name: 'Movie 1' },
        stream: { url: 'http://stream.url' }
    };

    it('should create a room with creator auto-joined', () => {
        const manager = new RoomManager();
        const client = makeClient();
        const { room } = manager.create(client, options);

        expect(room).toBeDefined();
        expect(room.owner).toBe(client.id);
        expect(room.users.length).toBe(1);
        expect(room.users[0].id).toBe(client.id);
        expect(client.room_id).toBe(room.id);
        expect(manager.roomCount).toBe(1);
    });

    it('should create rooms with unique IDs', () => {
        const manager = new RoomManager();
        const client = makeClient();
        const { room: room1 } = manager.create(client, options);
        const { room: room2 } = manager.create(client, options);

        expect(room1.id).not.toBe(room2.id);
        expect(manager.roomCount).toBe(1);
    });

    it('should leave old room when creating a new one', () => {
        const manager = new RoomManager();
        const client = makeClient();
        const { room: room1 } = manager.create(client, options);
        const room1Id = room1.id;

        manager.create(client, options);

        expect(manager.get(room1Id)).toBeUndefined();
    });

    it('should join a room', () => {
        const manager = new RoomManager();
        const client = makeClient();
        const { room } = manager.create(client, options);

        const otherClient = makeClient();
        const result = manager.join(otherClient, room.id);

        expect(result).toBeDefined();
        expect(result?.room.users.length).toBe(2);
        expect(otherClient.room_id).toBe(room.id);
    });

    it('should not duplicate user when joining same room twice', () => {
        const manager = new RoomManager();
        const client = makeClient();
        const { room } = manager.create(client, options);

        manager.join(client, room.id);

        expect(room.users.length).toBe(1);
    });

    it('should leave old room when joining a new one', () => {
        const manager = new RoomManager();
        const client1 = makeClient();
        const client2 = makeClient();

        const { room: room1 } = manager.create(client1, options);
        manager.join(client2, room1.id);

        const { room: room2 } = manager.create(makeClient(), options);
        manager.join(client2, room2.id);

        expect(room1.users.length).toBe(1);
        expect(room1.users[0].id).toBe(client1.id);
        expect(room2.users.length).toBe(2);
    });

    it('should return null when joining non-existent room', () => {
        const manager = new RoomManager();
        const client = makeClient();
        const result = manager.join(client, 'non-existent');
        expect(result).toBeNull();
    });

    it('should get client room', () => {
        const manager = new RoomManager();
        const client = makeClient();
        const { room } = manager.create(client, options);

        const foundRoom = manager.getClientRoom(client);
        expect(foundRoom?.id).toBe(room.id);
    });

    it('should return null for client not in any room', () => {
        const manager = new RoomManager();
        const client = makeClient();

        const foundRoom = manager.getClientRoom(client);
        expect(foundRoom).toBeNull();
    });

    it('should leave a room', () => {
        const manager = new RoomManager();
        const client1 = makeClient();
        const client2 = makeClient();

        const { room } = manager.create(client1, options);
        manager.join(client2, room.id);

        manager.leave(client2);

        expect(room.users.length).toBe(1);
        expect(client2.room_id).toBe('');
    });

    it('should transfer ownership when owner leaves', () => {
        const manager = new RoomManager();
        const client1 = makeClient();
        const client2 = makeClient();

        const { room } = manager.create(client1, options);
        manager.join(client2, room.id);

        manager.leave(client1);

        expect(room.owner).toBe(client2.id);
        expect(room.users.length).toBe(1);
    });

    it('should delete room when last user leaves', () => {
        const manager = new RoomManager();
        const client = makeClient();

        const { room } = manager.create(client, options);
        const roomId = room.id;

        manager.leave(client);

        expect(manager.get(roomId)).toBeUndefined();
        expect(manager.roomCount).toBe(0);
    });

    it('should update user in room', () => {
        const manager = new RoomManager();
        const client = makeClient();
        const { room } = manager.create(client, options);

        const updatedUser = { id: client.id, name: 'New Name', room_id: room.id };
        manager.updateUser(room.id, updatedUser);

        expect(room.users[0].name).toBe('New Name');
    });

    it('should return null when updating user in non-existent room', () => {
        const manager = new RoomManager();
        const result = manager.updateUser('non-existent', { id: 'x', name: 'x', room_id: 'x' });
        expect(result).toBeNull();
    });

    it('should update room owner', () => {
        const manager = new RoomManager();
        const client = makeClient();
        const { room } = manager.create(client, options);
        const otherUser = { id: 'other-id', name: 'Other', room_id: room.id };

        manager.updateOwner(room.id, otherUser);
        expect(room.owner).toBe('other-id');
    });

    it('should return null when updating owner of non-existent room', () => {
        const manager = new RoomManager();
        const result = manager.updateOwner('non-existent', { id: 'x', name: 'x', room_id: 'x' });
        expect(result).toBeNull();
    });

    it('should initialize room with default player state', () => {
        const manager = new RoomManager();
        const client = makeClient();
        const { room } = manager.create(client, options);

        expect(room.player).toEqual({ paused: true, buffering: true, time: 0 });
    });

    it('should copy meta and stream into room', () => {
        const manager = new RoomManager();
        const client = makeClient();
        const { room } = manager.create(client, options);

        expect(room.meta).toMatchObject(options.meta);
        expect(room.stream).toMatchObject(options.stream);
    });

    it('should cleanup disconnected users and remove empty rooms', () => {
        const manager = new RoomManager();
        const client1 = makeClient();
        const client2 = makeClient();

        const { room } = manager.create(client1, options);
        manager.join(client2, room.id);

        const activeIds = new Set([client2.id]);
        const changed = manager.cleanupDisconnectedUsers(activeIds);

        expect(changed.length).toBe(1);
        expect(room.users.length).toBe(1);
        expect(room.owner).toBe(client2.id);
    });

    it('should remove room entirely when all users disconnect', () => {
        const manager = new RoomManager();
        const client = makeClient();
        manager.create(client, options);

        manager.cleanupDisconnectedUsers(new Set());

        expect(manager.roomCount).toBe(0);
    });
});
