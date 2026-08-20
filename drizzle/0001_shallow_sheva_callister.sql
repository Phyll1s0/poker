CREATE TABLE `room_messages` (
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
	CONSTRAINT "room_messages_seat_check" CHECK("room_messages"."author_seat" between 0 and 5),
	CONSTRAINT "room_messages_kind_check" CHECK("room_messages"."kind" in ('text', 'reaction')),
	CONSTRAINT "room_messages_body_check" CHECK(length("room_messages"."body") between 1 and 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_room_messages_request` ON `room_messages` (`room_id`,`account_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_room_messages_room_cursor` ON `room_messages` (`room_id`,`id`);