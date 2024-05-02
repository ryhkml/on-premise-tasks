CREATE TABLE config (
	id						TEXT UNIQUE PRIMARY KEY,
	url 					TEXT NULL,
	method 					TEXT NULL,
	data 					TEXT NULL,
	cookie 					TEXT NULL,
	query 					TEXT NULL,
	headers 				TEXT NULL,
	authBasic 				TEXT NULL,
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
	dnsServer				TEXT NULL,
	dohUrl					TEXT NULL,
	dohInsecure				INTEGER NULL DEFAULT 0,
	httpVersion				TEXT NULL DEFAULT '1.1',
	insecure				INTEGER NULL DEFAULT 0,
	refererUrl				TEXT NULL,
	redirectAttempts		INTEGER NULL DEFAULT 8,
	keepAliveDuration		INTEGER NULL DEFAULT 30,
	resolve					TEXT NULL,
	FOREIGN KEY (id) REFERENCES queue(id)
);

CREATE INDEX idxIdRetrying ON config(id, retrying);

CREATE TRIGGER incrementRetryCount
AFTER UPDATE OF retrying ON config
WHEN NEW.retrying = 1
BEGIN
    UPDATE config SET retryCount = retryCount + 1 WHERE id = NEW.id;
END;