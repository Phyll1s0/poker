PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_room_members` (
	`room_id` text NOT NULL,
	`account_id` text NOT NULL,
	`seat` integer NOT NULL,
	`ready` integer DEFAULT false NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `account_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "room_members_seat_check" CHECK("__new_room_members"."seat" between 0 and 9)
);
--> statement-breakpoint
INSERT INTO `__new_room_members`("room_id", "account_id", "seat", "ready", "joined_at") SELECT "room_id", "account_id", "seat", "ready", "joined_at" FROM `room_members`;--> statement-breakpoint
DROP TABLE `room_members`;--> statement-breakpoint
ALTER TABLE `__new_room_members` RENAME TO `room_members`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_room_members_room_seat` ON `room_members` (`room_id`,`seat`);--> statement-breakpoint
CREATE INDEX `idx_room_members_account_joined` ON `room_members` (`account_id`,`joined_at`);--> statement-breakpoint
CREATE TABLE `__new_room_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` text NOT NULL,
	`account_id` text NOT NULL,
	`request_id` text NOT NULL,
	`author_seat` integer NOT NULL,
	`author_handle` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "room_messages_seat_check" CHECK("__new_room_messages"."author_seat" between 0 and 9),
	CONSTRAINT "room_messages_kind_check" CHECK("__new_room_messages"."kind" in ('text', 'reaction')),
	CONSTRAINT "room_messages_body_check" CHECK(length("__new_room_messages"."body") between 1 and 120)
);
--> statement-breakpoint
INSERT INTO `__new_room_messages`("id", "room_id", "account_id", "request_id", "author_seat", "author_handle", "kind", "body", "created_at") SELECT "id", "room_id", "account_id", "request_id", "author_seat", "author_handle", "kind", "body", "created_at" FROM `room_messages`;--> statement-breakpoint
DROP TABLE `room_messages`;--> statement-breakpoint
ALTER TABLE `__new_room_messages` RENAME TO `room_messages`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_room_messages_request` ON `room_messages` (`room_id`,`account_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_room_messages_room_cursor` ON `room_messages` (`room_id`,`id`);--> statement-breakpoint
CREATE TABLE `__new_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`join_code` text NOT NULL,
	`owner_account_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`max_players` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`state_json` text,
	`current_hand_id` text,
	`hand_no` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`owner_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rooms_status_check" CHECK("__new_rooms"."status" in ('lobby', 'playing', 'closed')),
	CONSTRAINT "rooms_max_players_check" CHECK("__new_rooms"."max_players" between 2 and 10),
	CONSTRAINT "rooms_revision_check" CHECK("__new_rooms"."revision" >= 0),
	CONSTRAINT "rooms_hand_no_check" CHECK("__new_rooms"."hand_no" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_rooms`("id", "join_code", "owner_account_id", "name", "status", "max_players", "revision", "state_json", "current_hand_id", "hand_no", "created_at", "updated_at", "expires_at") SELECT "id", "join_code", "owner_account_id", "name", "status", "max_players", "revision", "state_json", "current_hand_id", "hand_no", "created_at", "updated_at", "expires_at" FROM `rooms`;--> statement-breakpoint
DROP TABLE `rooms`;--> statement-breakpoint
ALTER TABLE `__new_rooms` RENAME TO `rooms`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rooms_join_code` ON `rooms` (`join_code`);--> statement-breakpoint
CREATE INDEX `idx_rooms_owner_updated` ON `rooms` (`owner_account_id`,`updated_at`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
