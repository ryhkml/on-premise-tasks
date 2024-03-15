CREATE VIEW activeSubscriber
AS
SELECT
    id
    username,
    createdAt,
    tasksInQueue,
    tasksInQueueLimit
FROM
    subscriber
WHERE
    tasksInQueue >= 1 AND tasksInQueueLimit <= 1000