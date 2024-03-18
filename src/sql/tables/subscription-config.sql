CREATE TABLE subscriptionConfig (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriptionConfigId   TEXT UNIQUE NOT NULL,
    queueId                TEXT NOT NULL,
    url                    TEXT NOT NULL,
    method                 TEXT NOT NULL,
    bodyStringify          TEXT NULL,
    queryStringify         TEXT NULL,
    headersStringify       TEXT NULL,
    executionDelay         INTEGER NULL,
    executionAt            INTEGER NULL,
    retry                  INTEGER NULL,
    retrying               INTEGER NULL,
    retryCount             INTEGER NULL,
    retryLimit             INTEGER NULL,
    retryExponential       INTEGER NULL,
    retryTerminated        INTEGER NULL,
    estimateNextRetryAt    INTEGER NULL,
    timeout                INTEGER NULL,
    responseType           TEXT NULL,
    FOREIGN KEY (queueId) REFERENCES subscription(queueId)
);

CREATE INDEX ixSubscriptionConfigId ON subscriptionConfig(subscriptionConfigId);