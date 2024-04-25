CREATE TABLE timeframe (
	id 				INTEGER PRIMARY KEY,
    lastRecordAt	INTEGER NULL DEFAULT (STRFTIME('%s', 'now') * 1000)
);