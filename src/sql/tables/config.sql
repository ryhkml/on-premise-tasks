CREATE TABLE config (
	id						TEXT UNIQUE PRIMARY KEY,
	url 					TEXT NULL,
	method 					TEXT NULL,
	data 					TEXT NULL,
	cookie 					TEXT NULL,
	query 					TEXT NULL,
	headers 				TEXT NULL,
	authBasic 				TEXT NULL,
	authDigest 				TEXT NULL,
	authNtlm 				TEXT NULL,
	authAwsSigv4			TEXT NULL,
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
	timeoutAt 				INTEGER NULL DEFAULT 0,
	ca						TEXT NULL,
	location				INTEGER NULL DEFAULT 0,
	locationTrusted			TEXT NULL,
	proto					TEXT NULL,
	protoRedirect			TEXT NULL,
	dnsServer				TEXT NULL,
	dohUrl					TEXT NULL,
	dohInsecure				INTEGER NULL DEFAULT 0,
	httpVersion				TEXT NULL DEFAULT '1.1',
	insecure				INTEGER NULL DEFAULT 0,
	refererUrl				TEXT NULL,
	redirectAttempts		INTEGER NULL DEFAULT 8,
	keepAliveDuration		INTEGER NULL DEFAULT 30,
	resolve					TEXT NULL,
	ipVersion				INTEGER,
	hsts					TEXT NULL,
	sessionId				INTEGER NULL DEFAULT 1,
	tlsVersion				TEXT NULL,
	tlsMaxVersion			TEXT NULL,
	haProxyClientIp			TEXT NULL,
	haProxyProtocol			INTEGER NULL,
	proxy					TEXT NULL,
	proxyAuthBasic			TEXT NULL,
	proxyAuthDigest			TEXT NULL,
	proxyAuthNtlm			TEXT NULL,
	proxyHeaders			TEXT NULL,
	proxyHttpVersion		TEXT NULL DEFAULT '1.1',
	proxyInsecure			INTEGER NULL DEFAULT 0,
	FOREIGN KEY (id) REFERENCES queue(id)
);

CREATE INDEX idxIdRetrying ON config(id, retrying);

CREATE TRIGGER incrementRetryCount
AFTER UPDATE OF retrying ON config
WHEN NEW.retrying = 1
BEGIN
    UPDATE config SET retryCount = retryCount + 1 WHERE id = NEW.id;
END;