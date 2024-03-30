CREATE TABLE timeframe (
	id 				INTEGER PRIMARY KEY,
    lastRecordAt	INTEGER NULL DEFAULT (STRFTIME('%s', 'now') * 1000)
);

CREATE TRIGGER updateLastRecord
AFTER UPDATE ON timeframe
BEGIN
	UPDATE timeframe SET lastRecordAt = (STRFTIME('%s', 'now') * 1000) WHERE rowId = NEW.rowId;
END;