DROP TABLE IF EXISTS timeframe;

CREATE TABLE IF NOT EXISTS timeframe (
	id 				INTEGER PRIMARY KEY,
    lastRecordAt	INTEGER NULL DEFAULT (STRFTIME('%s', 'now') * 1000)
);

CREATE TRIGGER trackLastRecord
AFTER UPDATE OF lastRecordAt ON timeframe
BEGIN
	UPDATE timeframe SET lastRecordAt = (STRFTIME('%s', 'now') * 1000) WHERE id = 1;
END;