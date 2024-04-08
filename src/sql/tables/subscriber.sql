CREATE TABLE subscriber (
	subscriberId 		TEXT UNIQUE PRIMARY KEY,
	subscriberName 		TEXT UNIQUE NOT NULL,
	key 				TEXT NOT NULL,
	createdAt 			INTEGER NOT NULL,
	tasksInQueue 		INTEGER NULL DEFAULT 0,
	tasksInQueueLimit 	INTEGER NULL DEFAULT 1000
);

CREATE INDEX ixSubscriberIdxNamexTasksInQueue ON subscriber(subscriberId, subscriberName, tasksInQueue);
CREATE INDEX ixSubscriberIdxTasksInQueuexLimit ON subscriber(subscriberId, tasksInQueue, tasksInQueueLimit);

CREATE TRIGGER deleteUnusedQueue
AFTER DELETE ON subscriber
BEGIN
	DELETE FROM queue WHERE NOT EXISTS (SELECT 'Done' AS deleted FROM queue WHERE subscriberId = OLD.subscriberId);
END;