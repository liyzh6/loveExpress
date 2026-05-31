CREATE TABLE IF NOT EXISTS app_state (
  id INT PRIMARY KEY,
  data JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO app_state (id, data)
VALUES (1, JSON_OBJECT(
  'users', JSON_ARRAY(),
  'orders', JSON_ARRAY(),
  'posts', JSON_ARRAY(),
  'comments', JSON_ARRAY(),
  'refundRequests', JSON_ARRAY(),
  'disputes', JSON_ARRAY(),
  'operationLogs', JSON_ARRAY()
))
ON DUPLICATE KEY UPDATE id = id;
