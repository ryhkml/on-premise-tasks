CREATE TABLE subscriber (
    id                  TEXT PRIMARY KEY NOT NULL,
    username            TEXT             NOT NULL,
    secretKey           TEXT             NOT NULL,
    createdAt           NUMERIC          NOT NULL,
    tasksInQueue        INTEGER          DEFAULT 0,
    tasksInQueueLimit   INTEGER          DEFAULT 1000
);