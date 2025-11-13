-- schema-mariadb.sql (base)
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY NOT NULL DEFAULT (UUID()),
  email VARCHAR(255) UNIQUE,
  password_hash TEXT,
  name VARCHAR(255),
  phone VARCHAR(50),
  id_number VARCHAR(100),
  role VARCHAR(32) NOT NULL DEFAULT 'user',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS raffles (
  id CHAR(36) PRIMARY KEY NOT NULL DEFAULT (UUID()),
  owner_id CHAR(36),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  start_at DATETIME,
  end_at DATETIME,
  draw_at DATETIME,
  external_draw_platform VARCHAR(512),
  total_numbers INT NULL,
  banner_url VARCHAR(1000),
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_raffles_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS raffle_prizes (
  id CHAR(36) PRIMARY KEY NOT NULL DEFAULT (UUID()),
  raffle_id CHAR(36) NOT NULL,
  position INT NOT NULL,
  description TEXT,
  quantity INT DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_raffle_position (raffle_id, position),
  CONSTRAINT fk_prizes_raffle FOREIGN KEY (raffle_id) REFERENCES raffles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS preorders (
  id CHAR(36) PRIMARY KEY NOT NULL DEFAULT (UUID()),
  raffle_id CHAR(36) NOT NULL,
  requested_number INT NULL,
  buyer_name VARCHAR(255) NOT NULL,
  buyer_email VARCHAR(255) NOT NULL,
  buyer_phone VARCHAR(50),
  buyer_id_number VARCHAR(100),
  user_id CHAR(36),
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  note TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_preorders_raffle FOREIGN KEY (raffle_id) REFERENCES raffles(id) ON DELETE CASCADE,
  CONSTRAINT fk_preorders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  KEY idx_preorders_raffle_status (raffle_id, status),
  UNIQUE KEY uq_preorder_raffle_number (raffle_id, requested_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_submissions (
  id CHAR(36) PRIMARY KEY NOT NULL DEFAULT (UUID()),
  preorder_id CHAR(36) NOT NULL,
  bank_name VARCHAR(255),
  bank_sender_id VARCHAR(255),
  bank_payment_id VARCHAR(255),
  amount DECIMAL(12,2),
  currency VARCHAR(8) DEFAULT 'USD',
  capture_url VARCHAR(1000),
  status VARCHAR(32) NOT NULL DEFAULT 'submitted',
  validated_by CHAR(36),
  validated_at DATETIME,
  admin_note TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_preorder FOREIGN KEY (preorder_id) REFERENCES preorders(id) ON DELETE CASCADE,
  CONSTRAINT fk_payment_validated_by FOREIGN KEY (validated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tickets (
  id CHAR(36) PRIMARY KEY NOT NULL DEFAULT (UUID()),
  raffle_id CHAR(36) NOT NULL,
  number INT NOT NULL,
  preorder_id CHAR(36),
  owner_name VARCHAR(255),
  owner_email VARCHAR(255),
  owner_phone VARCHAR(50),
  owner_id_number VARCHAR(100),
  assigned_by CHAR(36),
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tickets_raffle FOREIGN KEY (raffle_id) REFERENCES raffles(id) ON DELETE CASCADE,
  CONSTRAINT fk_tickets_preorder FOREIGN KEY (preorder_id) REFERENCES preorders(id) ON DELETE SET NULL,
  CONSTRAINT fk_tickets_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_tickets_raffle_number (raffle_id, number),
  KEY idx_tickets_raffle_number (raffle_id, number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS draws (
  id CHAR(36) PRIMARY KEY NOT NULL DEFAULT (UUID()),
  raffle_id CHAR(36) NOT NULL,
  draw_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  external_reference VARCHAR(1000),
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_draws_raffle FOREIGN KEY (raffle_id) REFERENCES raffles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS winners (
  id CHAR(36) PRIMARY KEY NOT NULL DEFAULT (UUID()),
  draw_id CHAR(36) NOT NULL,
  ticket_id CHAR(36),
  prize_id CHAR(36),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_winners_draw FOREIGN KEY (draw_id) REFERENCES draws(id) ON DELETE CASCADE,
  CONSTRAINT fk_winners_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL,
  CONSTRAINT fk_winners_prize FOREIGN KEY (prize_id) REFERENCES raffle_prizes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY NOT NULL DEFAULT (UUID()),
  entity_type VARCHAR(100),
  entity_id VARCHAR(255),
  action VARCHAR(100),
  payload JSON,
  performed_by CHAR(36),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_performed_by FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;