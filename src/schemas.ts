import { z } from 'zod';

// --- Zod schemas (source of truth for validation) ---

export const MetaSchema = z.object({
    id: z.string().max(200),
    type: z.string().max(50),
    name: z.string().max(500),
    description: z.string().max(2000).optional(),
    year: z.number().optional(),
    logo: z.string().max(2000).optional(),
    poster: z.string().max(2000).optional(),
    background: z.string().max(2000).optional(),
});

export const StreamSchema = z.object({
    url: z.string().max(2000).optional(),
    infoHash: z.string().max(100).optional(),
    fileIdx: z.number().optional(),
}).refine(data => data.url || data.infoHash, {
    message: "Either url or infoHash must be provided",
});

export const PlayerSchema = z.object({
    paused: z.boolean(),
    buffering: z.boolean(),
    time: z.number().min(0).finite(),
    speed: z.number().min(0.25).max(4).optional(),
    audioTrack: z.number().int().min(0).optional(),
    subtitleTrack: z.number().int().min(-1).optional(), // -1 = disabled
});

export const ClientUserUpdateSchema = z.object({
    username: z.string().min(1).max(25),
});

export const ClientNewRoomSchema = z.object({
    meta: MetaSchema,
    stream: StreamSchema,
});

export const ClientJoinRoomSchema = z.object({
    id: z.string().max(100),
});

export const ClientMessageSchema = z.object({
    content: z.string().min(1).max(300),
});

export const ClientUpdateOwnershipSchema = z.object({
    userId: z.string().max(100),
});

export const ClientSyncSchema = PlayerSchema;

export const ClientUpdateStreamSchema = z.object({
    stream: StreamSchema,
    meta: MetaSchema.optional(),
});

export const EventSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("user.update"), payload: ClientUserUpdateSchema }),
    z.object({ type: z.literal("room.new"), payload: ClientNewRoomSchema }),
    z.object({ type: z.literal("room.join"), payload: ClientJoinRoomSchema }),
    z.object({ type: z.literal("room.leave"), payload: z.object({}) }),
    z.object({ type: z.literal("room.message"), payload: ClientMessageSchema }),
    z.object({ type: z.literal("room.updateOwnership"), payload: ClientUpdateOwnershipSchema }),
    z.object({ type: z.literal("room.updateStream"), payload: ClientUpdateStreamSchema }),
    z.object({ type: z.literal("player.sync"), payload: ClientSyncSchema }),
]);

// --- Inferred types ---

export type Meta = z.infer<typeof MetaSchema>;
export type Stream = z.infer<typeof StreamSchema>;
export type Player = z.infer<typeof PlayerSchema>;

export const DEFAULT_PLAYER: Player = {
    paused: true,
    buffering: true,
    time: 0,
};

export type User = {
    id: string;
    name: string;
    room_id: string;
};

export interface RoomOptions {
    meta: Meta;
    stream: Stream;
}

export interface Room {
    id: string;
    stream: Stream;
    meta: Meta;
    users: User[];
    player: Player;
    owner: string;
    lastActivity: number;
}
