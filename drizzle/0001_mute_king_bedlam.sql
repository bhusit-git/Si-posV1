CREATE TABLE `production_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_type_id` integer NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`note` text,
	`created_at` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`product_type_id`) REFERENCES `product_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `status` text DEFAULT 'paid' NOT NULL;