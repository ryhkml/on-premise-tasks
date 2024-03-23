CREATE TABLE queue (
	id 						INTEGER PRIMARY KEY AUTOINCREMENT,
	queueId 				TEXT UNIQUE NOT NULL,
	subscriberId 			TEXT NOT NULL,
	state 					TEXT NULL DEFAULT "RUNNING",
	statusCode 				INTEGER NULL DEFAULT 0,
	estimateEndAt 			INTEGER NULL DEFAULT 0,
	estimateExecutionAt 	INTEGER NOT NULL,
	FOREIGN KEY (subscriberId) REFERENCES subscriber(subscriberId) ON DELETE CASCADE
);

CREATE INDEX ixQueueId ON queue(queueId);