DROP TABLE IF EXISTS subscriber;

CREATE TABLE IF NOT EXISTS subscriber (
	id					INTEGER PRIMARY KEY AUTOINCREMENT,
	subscriberId 		TEXT UNIQUE NOT NULL,
	subscriberName 		TEXT UNIQUE NOT NULL,
	key 				TEXT NOT NULL,
	createdAt 			INTEGER NOT NULL,
	tasksInQueue 		INTEGER NULL DEFAULT 0,
	tasksInQueueLimit 	INTEGER NULL DEFAULT 1000
);

CREATE INDEX ixSubscriberId ON subscriber(subscriberId);

CREATE INDEX ixSubscriberName ON subscriber(subscriberName);