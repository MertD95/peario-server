import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import WS from './ws';
import { PORT, PEM_CERT, PEM_KEY, USE_TLS, INTERVAL_ROOM_UPDATE } from './config';
import type { ClientNewRoom, ClientJoinRoom, ClientLeaveRoom, ClientMessage, ClientSync, ClientUserUpdate, ClientUpdateOwnership, ClientUpdateStream } from './events';
import { RoomEvent, SyncEvent, MessageEvent, ErrorEvent, UserEvent } from './events';
import type Client from './client';
import logger from './logger';
import RoomManager from './room-manager';

function createHttpServer() {
    const handler = (_req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeHead(200);
        res.end('ok');
    };

    if (USE_TLS) {
        return https.createServer({
            cert: fs.readFileSync(PEM_CERT!),
            key: fs.readFileSync(PEM_KEY!)
        }, handler);
    }

    return http.createServer(handler);
}

export function startServer(port: number = PORT) {
    const server = createHttpServer().listen(port);
    const protocol = USE_TLS ? 'wss' : 'ws';

    logger.info(`Listening on port ${port} (${protocol})`);

    const wss = new WS(server);
    const roomManager = new RoomManager();

    wss.events.on('user.update', updateUser);
    wss.events.on('room.new', createRoom);
    wss.events.on('room.join', joinRoom);
    wss.events.on('room.leave', leaveRoom);
    wss.events.on('room.message', messageRoom);
    wss.events.on('room.updateOwnership', updateRoomOwnership);
    wss.events.on('room.updateStream', updateStream);
    wss.events.on('player.sync', syncPlayer);
    wss.events.on('client.disconnect', handleDisconnect);

    function updateUser({ client, payload }: ClientUserUpdate) {
        client.name = payload.username;

        const user = client.toUser();
        client.sendEvent(new UserEvent(user));

        const room = roomManager.getClientRoom(client);
        if (room) {
            roomManager.updateUser(room.id, user);
            wss.sendToRoomClients(room.id, new SyncEvent(room));
        }
    }

    function createRoom({ client, payload }: ClientNewRoom) {
        const { room, leftRoomId } = roomManager.create(client, payload);

        if (leftRoomId) {
            wss.removeClientFromRoom(client.id, leftRoomId);
            const oldRoom = roomManager.get(leftRoomId);
            if (oldRoom) wss.sendToRoomClients(leftRoomId, new SyncEvent(oldRoom));
        }

        wss.addClientToRoom(client.id, room.id);
        client.sendEvent(new RoomEvent(room));
    }

    function joinRoom({ client, payload }: ClientJoinRoom) {
        const { id } = payload;

        const result = roomManager.join(client, id);
        if (!result) return client.sendEvent(new ErrorEvent('room'));

        const { room, leftRoomId } = result;

        if (leftRoomId) {
            wss.removeClientFromRoom(client.id, leftRoomId);
            const oldRoom = roomManager.get(leftRoomId);
            if (oldRoom) wss.sendToRoomClients(leftRoomId, new SyncEvent(oldRoom));
        }

        wss.addClientToRoom(client.id, room.id);
        wss.sendToRoomClients(room.id, new SyncEvent(room));
    }

    function leaveRoom({ client }: ClientLeaveRoom) {
        const roomId = client.room_id;
        if (!roomId) return;

        const room = roomManager.leave(client);
        wss.removeClientFromRoom(client.id, roomId);

        if (room && room.users.length > 0) {
            wss.sendToRoomClients(room.id, new SyncEvent(room));
        }
    }

    function messageRoom({ client, payload }: ClientMessage) {
        const room = roomManager.getClientRoom(client);
        if (!room) return client.sendEvent(new ErrorEvent('room'));

        const event = new MessageEvent(client, payload.content);
        if ((event.payload.date - client.cooldown) / 1000 < 3) return client.sendEvent(new ErrorEvent('cooldown'));

        roomManager.touchRoom(room.id);
        wss.sendToRoomClients(room.id, event);
        client.resetCooldown();
    }

    function updateRoomOwnership({ client, payload }: ClientUpdateOwnership) {
        const room = roomManager.getClientRoom(client);
        if (!room) return client.sendEvent(new ErrorEvent('room'));

        if (room.owner !== client.id) return client.sendEvent(new ErrorEvent('owner'));

        const roomUser = room.users.find(({ id, room_id }) => id === payload.userId && room_id === room.id);
        if (!roomUser) return client.sendEvent(new ErrorEvent('user'));

        const updatedRoom = roomManager.updateOwner(room.id, roomUser);
        if (updatedRoom) {
            wss.sendToRoomClients(updatedRoom.id, new SyncEvent(updatedRoom));
        }
    }

    function updateStream({ client, payload }: ClientUpdateStream) {
        const room = roomManager.getClientRoom(client);
        if (!room) return client.sendEvent(new ErrorEvent('room'));

        if (room.owner !== client.id) return client.sendEvent(new ErrorEvent('owner'));

        room.stream = payload.stream;
        if (payload.meta) {
            room.meta = payload.meta;
        }
        room.player = { paused: true, buffering: true, time: 0 };

        wss.sendToRoomClients(room.id, new SyncEvent(room));
    }

    function syncPlayer({ client, payload: player }: ClientSync) {
        const room = roomManager.getClientRoom(client);
        if (!room) return client.sendEvent(new ErrorEvent('room'));

        roomManager.touchRoom(room.id);

        if (room.owner === client.id) {
            room.player = player;

            const clients = wss.getClientsByRoomId(room.id).filter(c => c.id !== client.id);
            wss.sendToClients(clients, new SyncEvent(room));
        } else {
            client.sendEvent(new SyncEvent(room));
        }
    }

    function handleDisconnect({ client }: { client: Client }) {
        const roomId = client.room_id;
        const room = roomManager.leave(client);

        if (roomId) {
            wss.removeClientFromRoom(client.id, roomId);
        }

        if (room && room.users.length > 0) {
            wss.sendToRoomClients(room.id, new SyncEvent(room));
        }
    }

    const roomCleanupInterval = setInterval(() => {
        const activeClientIds = wss.allClientIds;
        const changedRooms = roomManager.cleanupDisconnectedUsers(activeClientIds);

        for (const room of changedRooms) {
            wss.sendToRoomClients(room.id, new SyncEvent(room));
        }

        const expiredRoomIds = roomManager.expireInactiveRooms();
        for (const roomId of expiredRoomIds) {
            wss.deleteRoom(roomId);
        }
    }, INTERVAL_ROOM_UPDATE);

    function close() {
        clearInterval(roomCleanupInterval);
        wss.close();
        server.close();
    }

    return { server, close };
}
