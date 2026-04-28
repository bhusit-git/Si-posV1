CREATE TABLE `bag_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`product_type_id` integer NOT NULL,
	`type` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`transaction_id` integer,
	`note` text,
	`created_at` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_type_id`) REFERENCES `product_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customer_prices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`product_type_id` integer NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL,
	`bag_deposit` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_type_id`) REFERENCES `product_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`credit` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_en` text,
	`has_bag` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL,
	`product_type_id` integer NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_type_id`) REFERENCES `product_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`paid` real DEFAULT 0 NOT NULL,
	`pool` integer,
	`row` integer,
	`col` integer,
	`sale_date` text NOT NULL,
	`sale_time` text NOT NULL,
	`created_at` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);