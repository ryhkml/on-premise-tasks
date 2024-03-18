CREATE TABLE subscriber (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriberId        TEXT UNIQUE NOT NULL,
    subscriberName      TEXT UNIQUE NOT NULL,
    key                 TEXT NOT NULL,
    createdAt           INTEGER NOT NULL,
    tasksInQueue        INTEGER NOT NULL,
    tasksInQueueLimit   INTEGER NOT NULL,
    CHECK (tasksInQueue <= tasksInQueueLimit)
);

CREATE INDEX ixSubscriberId ON subscriber(subscriberId);

CREATE INDEX ixSubscriberName ON subscriber(subscriberName);