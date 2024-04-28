CREATE TABLE subscriber (
	id					TEXT UNIQUE PRIMARY KEY,
	key					TEXT NOT NULL,
	name				TEXT UNIQUE NOT NULL,
	createdAt			INTEGER NOT NULL,
	tasksInQueue		INTEGER NULL DEFAULT 0,
	tasksInQueueLimit	INTEGER NULL DEFAULT 1000
);

CREATE INDEX idxIdNameTasksInQueue ON subscriber(id, name, tasksInQueue);
CREATE INDEX idxIdTasksInQueueLimit ON subscriber(id, tasksInQueue, tasksInQueueLimit);

CREATE TRIGGER deleteUnusedQueue
AFTER DELETE ON subscriber
BEGIN
	DELETE FROM queue WHERE subscriberId = OLD.id;
END;