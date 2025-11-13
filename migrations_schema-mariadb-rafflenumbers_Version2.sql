-- schema-mariadb-rafflenumbers.sql (raffle_numbers + SP)
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS raffle_numbers (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  raffle_id CHAR(36) NOT NULL,
  number INT NOT NULL,
  state ENUM('available','reserved','assigned') NOT NULL DEFAULT 'available',
  preorder_id CHAR(36) DEFAULT NULL,
  reserved_at DATETIME DEFAULT NULL,
  expires_at DATETIME DEFAULT NULL,
  assigned_at DATETIME DEFAULT NULL,
  assigned_by CHAR(36) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_raffle_number (raffle_id, number),
  INDEX idx_raffle_state (raffle_id, state),
  CONSTRAINT fk_rn_raffle FOREIGN KEY (raffle_id) REFERENCES raffles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rn_preorder FOREIGN KEY (preorder_id) REFERENCES preorders(id) ON DELETE SET NULL,
  CONSTRAINT fk_rn_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS populate_raffle_numbers;
DELIMITER $$
CREATE PROCEDURE populate_raffle_numbers(IN p_raffle_id CHAR(36), IN p_total_numbers INT)
BEGIN
  DECLARE i INT DEFAULT 1;
  DECLARE v_exists INT DEFAULT 0;

  IF p_total_numbers IS NULL OR p_total_numbers <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p_total_numbers debe ser > 0';
  END IF;

  start_loop: LOOP
    IF i > p_total_numbers THEN
      LEAVE start_loop;
    END IF;

    SELECT COUNT(*) INTO v_exists FROM raffle_numbers WHERE raffle_id = p_raffle_id AND number = i;
    IF v_exists = 0 THEN
      INSERT INTO raffle_numbers (id, raffle_id, number, state) VALUES (UUID(), p_raffle_id, i, 'available');
    END IF;

    SET i = i + 1;
  END LOOP start_loop;
END$$
DELIMITER ;

CREATE INDEX IF NOT EXISTS idx_rn_raffle_state_number ON raffle_numbers (raffle_id, state, number);