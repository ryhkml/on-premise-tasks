CREATE TABLE queue (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    queueId                TEXT UNIQUE NOT NULL,
    subscriberId           TEXT NOT NULL,
    state                  TEXT NOT NULL,
    statusCode             INTEGER NOT NULL,
    estimateEndAt          INTEGER NOT NULL,
    estimateExecutionAt    INTEGER NOT NULL,
    FOREIGN KEY (subscriberId) REFERENCES subscriber(subscriberId)
);

CREATE INDEX ixQueueId ON queue(queueId);