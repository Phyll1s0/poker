import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  authSubject: text("auth_subject").notNull(),
  handle: text("handle").notNull(),
  handleKey: text("handle_key").notNull(),
  avatarSeed: text("avatar_seed").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_accounts_auth_subject").on(table.authSubject),
  uniqueIndex("idx_accounts_handle_key").on(table.handleKey),
]);

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  joinCode: text("join_code").notNull(),
  ownerAccountId: text("owner_account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status", { enum: ["lobby", "playing", "closed"] }).notNull().default("lobby"),
  maxPlayers: integer("max_players").notNull(),
  revision: integer("revision").notNull().default(0),
  stateJson: text("state_json"),
  currentHandId: text("current_hand_id"),
  handNo: integer("hand_no").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [
  uniqueIndex("idx_rooms_join_code").on(table.joinCode),
  index("idx_rooms_owner_updated").on(table.ownerAccountId, table.updatedAt),
  check("rooms_status_check", sql`${table.status} in ('lobby', 'playing', 'closed')`),
  check("rooms_max_players_check", sql`${table.maxPlayers} between 2 and 10`),
  check("rooms_revision_check", sql`${table.revision} >= 0`),
  check("rooms_hand_no_check", sql`${table.handNo} >= 0`),
]);

export const roomMembers = sqliteTable("room_members", {
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  seat: integer("seat").notNull(),
  ready: integer("ready", { mode: "boolean" }).notNull().default(false),
  joinedAt: integer("joined_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.roomId, table.accountId] }),
  uniqueIndex("idx_room_members_room_seat").on(table.roomId, table.seat),
  index("idx_room_members_account_joined").on(table.accountId, table.joinedAt),
  check("room_members_seat_check", sql`${table.seat} between 0 and 9`),
]);

export const roomMessages = sqliteTable("room_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  requestId: text("request_id").notNull(),
  authorSeat: integer("author_seat").notNull(),
  authorHandle: text("author_handle").notNull(),
  kind: text("kind", { enum: ["text", "reaction"] }).notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_room_messages_request").on(table.roomId, table.accountId, table.requestId),
  index("idx_room_messages_room_cursor").on(table.roomId, table.id),
  check("room_messages_seat_check", sql`${table.authorSeat} between 0 and 9`),
  check("room_messages_kind_check", sql`${table.kind} in ('text', 'reaction')`),
  check("room_messages_body_check", sql`length(${table.body}) between 1 and 120`),
]);
