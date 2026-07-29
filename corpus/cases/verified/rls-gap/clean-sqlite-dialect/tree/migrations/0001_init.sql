CREATE TABLE `subscription` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `time_created` integer DEFAULT (unixepoch()) NOT NULL
);

CREATE TABLE `key_rate_limit` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `key_id` text NOT NULL
);
