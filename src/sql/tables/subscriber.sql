CREATE TABLE subscriber (
	id					INTEGER PRIMARY KEY AUTOINCREMENT,
	subscriberId 		TEXT UNIQUE NOT NULL,
	subscriberName 		TEXT UNIQUE NOT NULL,
	key 				TEXT NOT NULL,
	createdAt 			INTEGER NOT NULL,
	tasksInQueue 		INTEGER NULL DEFAULT 0,
	tasksInQueueLimit 	INTEGER NULL DEFAULT 1000
);

CREATE UNIQUE INDEX ixSubscriberId ON subscriber(subscriberId);

CREATE UNIQUE INDEX ixSubscriberName ON subscriber(subscriberName);