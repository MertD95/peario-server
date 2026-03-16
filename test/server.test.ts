import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { startServer } from '../src/server';

const TEST_PORT = 8182;
const serverUrl = `ws://localhost:${TEST_PORT}`;

const meta = {
    id: 'tt1234567',
    type: 'movie',
    name: 'Mirabelle'
};

const stream = {
    infoHash: '8ca6f333316aba4a769fdb8c2d5824eb9bb92763'
};

const defaultPlayer = {
    paused: true,
    buffering: true,
    time: 0
};

type EventPayload = { type: string; payload: any };

function createClient(catchReady = true): Promise<WebSocket & { id?: string; sendEvent: (type: string, payload: any) => void; createRoom: () => Promise<any>; joinRoom: (id: string) => Promise<any> }> {
    return new Promise(resolve => {
        const client = new WebSocket(serverUrl) as any;
        client.sendEvent = (type: string, payload: any) => {
            client.send(JSON.stringify({ type, payload }));
        };

        client.on('message', (event: Buffer) => {
            const { type, payload } = JSON.parse(event.toString());
            client.emit('event', type, payload);
        });

        if (catchReady) {
            client.once('event', (type: string, payload: any) => {
                if (type === 'ready') {
                    client.id = payload.user.id;
                    resolve(client);
                }
            });
        } else {
            client.once('open', () => resolve(client));
        }

        client.createRoom = () => {
            return new Promise((resolve) => {
                client.once('event', (type: string, payload: any) => {
                    if (type === 'room') resolve(payload);
                });
                client.sendEvent('room.new', { meta, stream });
            });
        };

        client.joinRoom = (id: string) => {
            return new Promise((resolve) => {
                client.once('event', (type: string, payload: any) => {
                    if (type === 'sync') resolve(payload);
                });
                client.sendEvent('room.join', { id });
            });
        };
    });
}

function testRoomObject(payload: any) {
    expect(payload.stream).toEqual(stream);
    expect(payload.meta).toMatchObject(meta);
    expect(payload.player).toEqual(defaultPlayer);
    expect(Array.isArray(payload.users)).toBe(true);
}

describe('Integration: Client-Server', () => {
    let app: ReturnType<typeof startServer>;

    beforeAll(() => {
        app = startServer(TEST_PORT);
    });

    afterAll(() => {
        app.close();
    });

    it('should return a ready event', async () => {
        const { event, client } = await new Promise<{ event: EventPayload; client: any }>((resolve) => {
            const ws = new WebSocket(serverUrl) as any;
            ws.on('message', (data: Buffer) => {
                const { type, payload } = JSON.parse(data.toString());
                resolve({ event: { type, payload }, client: ws });
            });
        });

        expect(event.type).toBe('ready');
        expect(typeof event.payload.user).toBe('object');
        expect(typeof event.payload.user.id).toBe('string');
        expect(typeof event.payload.user.name).toBe('string');
        expect(typeof event.payload.user.room_id).toBe('string');
        client.close();
    });

    it('should update username', async () => {
        const client = await createClient();
        const username = 'ohoh';

        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('user.update', { username });
        const { type, payload } = await event;

        expect(type).toBe('user');
        expect(payload.user.name).toBe(username);
        client.close();
    });

    it('should reject username longer than 25 chars', async () => {
        const client = await createClient();

        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('user.update', { username: 'a'.repeat(30) });
        const { type, payload } = await event;

        expect(type).toBe('error');
        expect(payload.type).toBe('validation');
        client.close();
    });

    it('should reject empty username', async () => {
        const client = await createClient();

        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('user.update', { username: '' });
        const { type, payload } = await event;

        expect(type).toBe('error');
        expect(payload.type).toBe('validation');
        client.close();
    });

    it('should create a room with creator auto-joined', async () => {
        const client = await createClient();
        const roomPayload = await client.createRoom();

        testRoomObject(roomPayload);
        expect(typeof roomPayload.id).toBe('string');
        expect(roomPayload.owner).toBe(client.id);
        expect(roomPayload.users.length).toBe(1);
        expect(roomPayload.users[0].id).toBe(client.id);
        client.close();
    });

    it('should reject room creation with invalid meta', async () => {
        const client = await createClient();

        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('room.new', { meta: { name: 'NoId' }, stream });
        const { type, payload } = await event;

        expect(type).toBe('error');
        expect(payload.type).toBe('validation');
        client.close();
    });

    it('should reject room creation with no stream source', async () => {
        const client = await createClient();

        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('room.new', { meta, stream: {} });
        const { type, payload } = await event;

        expect(type).toBe('error');
        expect(payload.type).toBe('validation');
        client.close();
    });

    it('should join a room that does not exist and return an error event', async () => {
        const client = await createClient();

        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('room.join', { id: 'nonexistent' });
        const { type, payload } = await event;

        expect(type).toBe('error');
        expect(payload.type).toBe('room');
        client.close();
    });

    it('should join a room and return a sync event', async () => {
        const client = await createClient();
        const otherClient = await createClient();

        const { id, owner } = await client.createRoom();
        const syncPayload = await otherClient.joinRoom(id);

        testRoomObject(syncPayload);
        expect(syncPayload.id).toBe(id);
        expect(syncPayload.owner).toBe(owner);
        expect(syncPayload.users.length).toBe(2);
        expect(syncPayload.users[0].id).toBe(owner);

        client.close();
        otherClient.close();
    });

    it('should send a message without joining a room and return a room error event', async () => {
        const client = await createClient();

        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('room.message', { content: '.' });
        const { type, payload } = await event;

        expect(type).toBe('error');
        expect(payload.type).toBe('room');
        client.close();
    });

    it('should send multiple messages and return a cooldown error event', async () => {
        const client = await createClient();
        await client.createRoom();

        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('room.message', { content: '.' });
        client.sendEvent('room.message', { content: '.' });

        const { type, payload } = await event;
        expect(type).toBe('error');
        expect(payload.type).toBe('cooldown');
        client.close();
    });

    it('should send a message and return a message event', async () => {
        const client = await createClient();
        await client.createRoom();

        await new Promise(r => setTimeout(r, 3000));

        const content = 'hello';
        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('room.message', { content });
        const { type, payload } = await event;

        expect(type).toBe('message');
        expect(payload.user).toBe(client.id);
        expect(payload.content).toBe(content);
        expect(typeof payload.date).toBe('number');
        client.close();
    }, 15000);

    it('should reject messages longer than 300 chars', async () => {
        const client = await createClient();
        await client.createRoom();

        const longContent = 'x'.repeat(500);
        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('room.message', { content: longContent });
        const { type, payload } = await event;

        expect(type).toBe('error');
        expect(payload.type).toBe('validation');
        client.close();
    });

    it('should let other clients join room', async () => {
        const client = await createClient();
        const otherClient = await createClient();

        const { id, owner } = await client.createRoom();
        const syncPayload = await otherClient.joinRoom(id);

        testRoomObject(syncPayload);
        expect(syncPayload.id).toBe(id);
        expect(syncPayload.owner).toBe(owner);
        expect(syncPayload.users.length).toBe(2);

        client.close();
        otherClient.close();
    });

    it('should try to update room ownership and return user error', async () => {
        const client = await createClient();
        await client.createRoom();

        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('room.updateOwnership', { userId: 'nonexistent' });
        const { type, payload } = await event;

        expect(type).toBe('error');
        expect(payload.type).toBe('user');
        client.close();
    });

    it('should not allow non-owner to transfer ownership', async () => {
        const client = await createClient();
        const otherClient = await createClient();

        const { id } = await client.createRoom();
        await otherClient.joinRoom(id);

        const event = new Promise<EventPayload>((resolve) => {
            otherClient.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        otherClient.sendEvent('room.updateOwnership', { userId: otherClient.id });
        const { type, payload } = await event;

        expect(type).toBe('error');
        expect(payload.type).toBe('owner');

        client.close();
        otherClient.close();
    });

    it('should update room ownership', async () => {
        const client = await createClient();
        const otherClient = await createClient();

        const { id } = await client.createRoom();
        await otherClient.joinRoom(id);

        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('room.updateOwnership', { userId: otherClient.id });
        const { type, payload } = await event;

        expect(type).toBe('sync');
        expect(payload.owner).toBe(otherClient.id);

        client.close();
        otherClient.close();
    });

    it('should sync player and return a player sync event to other clients', async () => {
        const playerUpdate = {
            paused: false,
            buffering: false,
            time: 100
        };

        const client = await createClient();
        const otherClient = await createClient();

        const { id } = await client.createRoom();
        await otherClient.joinRoom(id);

        const event = new Promise<EventPayload>((resolve) => {
            otherClient.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('player.sync', playerUpdate);
        const { type, payload } = await event;

        expect(type).toBe('sync');
        expect(payload.player).toEqual(playerUpdate);

        client.close();
        otherClient.close();
    });

    it('should not sync player from non-owner (returns current state instead)', async () => {
        const client = await createClient();
        const otherClient = await createClient();

        const { id } = await client.createRoom();
        await otherClient.joinRoom(id);

        const event = new Promise<EventPayload>((resolve) => {
            otherClient.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        otherClient.sendEvent('player.sync', { paused: false, buffering: false, time: 999 });
        const { type, payload } = await event;

        expect(type).toBe('sync');
        expect(payload.player).toEqual(defaultPlayer);

        client.close();
        otherClient.close();
    });

    it('should reject invalid event types', async () => {
        const client = await createClient();

        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('nonexistent.event', {});
        const { type, payload } = await event;

        expect(type).toBe('error');
        expect(payload.type).toBe('validation');
        client.close();
    });

    it('should reject malformed JSON', async () => {
        const client = await createClient();

        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.send('not json at all{{{');
        const { type, payload } = await event;

        expect(type).toBe('error');
        expect(payload.type).toBe('parse');
        client.close();
    });

    it('should notify room when a client disconnects', async () => {
        const client = await createClient();
        const otherClient = await createClient();

        const { id } = await client.createRoom();
        await otherClient.joinRoom(id);

        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        // otherClient disconnects
        otherClient.close();
        const { type, payload } = await event;

        expect(type).toBe('sync');
        expect(payload.users.length).toBe(1);
        expect(payload.users[0].id).toBe(client.id);
        client.close();
    });

    it('should transfer ownership when owner disconnects', async () => {
        const client = await createClient();
        const otherClient = await createClient();

        const { id } = await client.createRoom();
        await otherClient.joinRoom(id);

        const event = new Promise<EventPayload>((resolve) => {
            otherClient.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        // Owner disconnects
        client.close();
        const { type, payload } = await event;

        expect(type).toBe('sync');
        expect(payload.owner).toBe(otherClient.id);
        expect(payload.users.length).toBe(1);
        otherClient.close();
    });

    it('should explicitly leave a room via room.leave', async () => {
        const client = await createClient();
        const otherClient = await createClient();

        const { id } = await client.createRoom();
        await otherClient.joinRoom(id);

        const event = new Promise<EventPayload>((resolve) => {
            client.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        otherClient.sendEvent('room.leave', {});
        const { type, payload } = await event;

        expect(type).toBe('sync');
        expect(payload.users.length).toBe(1);
        expect(payload.users[0].id).toBe(client.id);

        client.close();
        otherClient.close();
    });

    it('should allow owner to change stream mid-session', async () => {
        const client = await createClient();
        const otherClient = await createClient();

        const { id } = await client.createRoom();
        await otherClient.joinRoom(id);

        const newStream = { url: 'http://new-stream.url/video.mp4' };

        const event = new Promise<EventPayload>((resolve) => {
            otherClient.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('room.updateStream', { stream: newStream });
        const { type, payload } = await event;

        expect(type).toBe('sync');
        expect(payload.stream).toEqual(newStream);
        // Player should be reset
        expect(payload.player.time).toBe(0);
        expect(payload.player.paused).toBe(true);

        client.close();
        otherClient.close();
    });

    it('should reject stream change from non-owner', async () => {
        const client = await createClient();
        const otherClient = await createClient();

        const { id } = await client.createRoom();
        await otherClient.joinRoom(id);

        const event = new Promise<EventPayload>((resolve) => {
            otherClient.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        otherClient.sendEvent('room.updateStream', { stream: { url: 'http://hack.url' } });
        const { type, payload } = await event;

        expect(type).toBe('error');
        expect(payload.type).toBe('owner');

        client.close();
        otherClient.close();
    });

    it('should sync player with audio/subtitle tracks and speed', async () => {
        const playerUpdate = {
            paused: false,
            buffering: false,
            time: 50,
            speed: 1.5,
            audioTrack: 2,
            subtitleTrack: 1,
        };

        const client = await createClient();
        const otherClient = await createClient();

        const { id } = await client.createRoom();
        await otherClient.joinRoom(id);

        const event = new Promise<EventPayload>((resolve) => {
            otherClient.once('event' as any, (type: string, payload: any) => resolve({ type, payload }));
        });

        client.sendEvent('player.sync', playerUpdate);
        const { type, payload } = await event;

        expect(type).toBe('sync');
        expect(payload.player).toEqual(playerUpdate);
        expect(payload.player.speed).toBe(1.5);
        expect(payload.player.audioTrack).toBe(2);
        expect(payload.player.subtitleTrack).toBe(1);

        client.close();
        otherClient.close();
    });
});
