CREATE TABLE subscriberConfig (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    queueId                TEXT NOT NULL,
    url                    TEXT NOT NULL,
    method                 TEXT NOT NULL,
    bodyStringify          TEXT NULL,
    queryStringify         TEXT NULL,
    headersStringify       TEXT NULL,
    executionDelay         INTEGER NULL,
    executeAt              INTEGER NULL,
    retry                  INTEGER NULL,
    retrying               INTEGER NULL,
    retryCount             INTEGER NULL,
    retryLimit             INTEGER NULL,
    retryExponential       INTEGER NULL,
    retryTerminated        INTEGER NULL,
    estimateNextRetryAt    INTEGER NULL,
    timeout                INTEGER NULL,
    FOREIGN KEY (queueId) REFERENCES queue(queueId)
);

CREATE INDEX ixSubscriberConfigQueueId ON subscriberConfig(queueId);