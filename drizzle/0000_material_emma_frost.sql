CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_subject` text NOT NULL,
	`handle` text NOT NULL,
	`handle_key` text NOT NULL,
	`avatar_seed` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_accounts_auth_subject` ON `accounts` (`auth_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_accounts_handle_key` ON `accounts` (`handle_key`);--> statement-breakpoint
CREATE TABLE `room_members` (
	`room_id` text NOT NULL,
	`account_id` text NOT NULL,
	`seat` integer NOT NULL,
	`ready` integer DEFAULT false NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `account_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "room_members_seat_check" CHECK("room_members"."seat" between 0 and 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_room_members_room_seat` ON `room_members` (`room_id`,`seat`);--> statement-breakpoint
CREATE INDEX `idx_room_members_account_joined` ON `room_members` (`account_id`,`joined_at`);--> statement-breakpoint
CREATE TABLE `rooms` (
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
	CONSTRAINT "rooms_status_check" CHECK("rooms"."status" in ('lobby', 'playing', 'closed')),
	CONSTRAINT "rooms_max_players_check" CHECK("rooms"."max_players" between 2 and 6),
	CONSTRAINT "rooms_revision_check" CHECK("rooms"."revision" >= 0),
	CONSTRAINT "rooms_hand_no_check" CHECK("rooms"."hand_no" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rooms_join_code` ON `rooms` (`join_code`);--> statement-breakpoint
CREATE INDEX `idx_rooms_owner_updated` ON `rooms` (`owner_account_id`,`updated_at`);