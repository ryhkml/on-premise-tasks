CREATE TABLE queue (
	id 						INTEGER PRIMARY KEY AUTOINCREMENT,
	queueId 				TEXT UNIQUE NOT NULL,
	subscriberId 			TEXT NOT NULL,
	state 					TEXT NULL DEFAULT 'RUNNING',
	statusCode 				INTEGER NULL DEFAULT 0,
	estimateEndAt 			INTEGER NULL DEFAULT 0,
	estimateExecutionAt 	INTEGER NOT NULL,
	FOREIGN KEY (subscriberId) REFERENCES subscriber(subscriberId) ON DELETE CASCADE
);

CREATE UNIQUE INDEX ixQueueId ON queue(queueId);

CREATE TRIGGER incrementTasksInQueue
BEFORE INSERT ON queue
WHEN NEW.state = 'RUNNING'
BEGIN
    UPDATE subscriber SET tasksInQueue = tasksInQueue + 1 WHERE subscriberId = NEW.subscriberId;
END;

CREATE TRIGGER decrementTasksInQueue
AFTER UPDATE OF state ON queue
WHEN NEW.state IN ('DONE', 'ERROR') AND OLD.state = 'RUNNING'
BEGIN
    UPDATE subscriber SET tasksInQueue = tasksInQueue - 1 WHERE subscriberId = NEW.subscriberId;
	UPDATE config SET retrying = 0, estimateNextRetryAt = 0 WHERE queueId = NEW.queueId;
END;

CREATE TRIGGER deleteUnusedConfig
AFTER DELETE ON queue
BEGIN
	DELETE FROM config WHERE NOT EXISTS (SELECT 'Done' AS deleted FROM queue WHERE queueId = OLD.queueId);
END;