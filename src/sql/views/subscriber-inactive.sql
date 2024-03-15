CREATE VIEW inactiveSubscriber
AS
SELECT
    id,
    username,
    createdAt,
    tasksInQueue,
    tasksInQueueLimit
FROM
    subscriber
WHERE
    tasksInQueue = 0