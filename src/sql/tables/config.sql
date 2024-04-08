CREATE TABLE config (
	configId 				TEXT UNIQUE PRIMARY KEY,
	queueId 				TEXT UNIQUE NOT NULL,
	url 					TEXT NULL,
	method 					TEXT NULL,
	bodyStringify 			TEXT NULL,
	queryStringify 			TEXT NULL,
	headersStringify 		TEXT NULL,
	executionDelay 			INTEGER NULL DEFAULT 1,
	executeAt 				INTEGER NULL DEFAULT 0,
	retry 					INTEGER NULL DEFAULT 0,
	retryAt 				INTEGER NULL DEFAULT 0,
	retrying 				INTEGER NULL DEFAULT 0,
	retryCount 				INTEGER NULL DEFAULT 0,
	retryLimit 				INTEGER NULL DEFAULT 0,
	retryInterval 			INTEGER NULL DEFAULT 0,
	retryStatusCode 		TEXT NULL DEFAULT '[]',
	retryExponential 		INTEGER NULL DEFAULT 1,
	estimateNextRetryAt 	INTEGER NULL DEFAULT 0,
	timeout 				INTEGER NULL DEFAULT 30000,
	FOREIGN KEY (queueId) REFERENCES queue(queueId)
);

CREATE INDEX ixConfigIdxQueueId ON config(configId, queueId);

CREATE TRIGGER incrementRetryCount
BEFORE UPDATE OF retrying ON config
WHEN NEW.retrying = 1
BEGIN
    UPDATE config SET retryCount = retryCount + 1 WHERE configId = NEW.configId;
END;