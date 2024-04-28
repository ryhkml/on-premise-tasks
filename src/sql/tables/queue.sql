CREATE TABLE queue (
	id						TEXT UNIQUE PRIMARY KEY,
	subscriberId 			TEXT NOT NULL,
	state 					TEXT NULL DEFAULT 'RUNNING',
	statusCode 				INTEGER NULL DEFAULT 0,
	finalize				BLOB NULL,
	createdAt 				INTEGER NOT NULL,
	expiredAt 				INTEGER NULL DEFAULT 0,
	estimateEndAt 			INTEGER NULL DEFAULT 0,
	estimateExecutionAt 	INTEGER NOT NULL,
	FOREIGN KEY (subscriberId) REFERENCES subscriber(id)
);

CREATE INDEX idxSubscriberId ON queue(subscriberId);
CREATE INDEX idxState ON queue(state);
CREATE INDEX idxIdSubscriberId ON queue(id, subscriberId);
CREATE INDEX idxIdState ON queue(id, state);
CREATE INDEX idxStateExpiredAt ON queue(state, expiredAt);

CREATE TRIGGER incrementTasksInQueue
AFTER INSERT ON queue
WHEN NEW.state = 'RUNNING'
BEGIN
    UPDATE subscriber SET tasksInQueue = tasksInQueue + 1 WHERE id = NEW.subscriberId;
END;

CREATE TRIGGER decrementTasksInQueue
AFTER UPDATE OF state ON queue
WHEN NEW.state IN ('DONE', 'ERROR') AND OLD.state = 'RUNNING'
BEGIN
    UPDATE subscriber SET tasksInQueue = tasksInQueue - 1 WHERE id = NEW.subscriberId;
	UPDATE queue SET expiredAt = (STRFTIME('%s', 'now') * 1000) + 1296000000 WHERE id = NEW.id;
	UPDATE config SET retrying = 0, estimateNextRetryAt = 0 WHERE id = NEW.id AND retrying = 1;
END;

CREATE TRIGGER deleteUnusedConfig
AFTER DELETE ON queue
BEGIN
	DELETE FROM config WHERE id = OLD.id;
END;