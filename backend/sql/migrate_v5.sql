-- ============================================================
-- APA Staff Report — v5 Feature Migration (new table)
-- Org config master lists: Departments & Position / Job Titles.
-- Replaces the hardcoded DEPARTMENTS / COMPANY_POSITIONS arrays
-- (frontend/src/data/mockData.ts) with admin-editable rows.
-- NOTE: no USE statement here — migrate.js already selects the
-- active database (supports both apastaffreport & apastaffreport2222).
-- Applied idempotently by scripts/migrate.js
-- ============================================================

-- ------------------------------------------------------------
-- org_config
-- One row per selectable department or job title. `is_active = 0`
-- is a SOFT delete: the row survives so historic reports / appraisals
-- / TRS tasks (which store department & position as text snapshots)
-- keep their original wording, while the value disappears from every
-- dropdown. Reactivate to bring it back.
-- name is VARCHAR(64) to match users.department / users.position.
-- The explicit utf8mb4_unicode_ci collation is REQUIRED: users.* columns use
-- utf8mb4_unicode_ci, and the usage-count subqueries below join them by string
-- comparison. MySQL 8's table default (utf8mb4_0900_ai_ci) would otherwise
-- raise "Illegal mix of collations" on every list query.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_config (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('department','position') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  name VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deactivated_by VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  deactivated_at DATETIME NULL,
  UNIQUE KEY uq_org_config_kind_name (kind, name),
  KEY idx_org_config_kind_active (kind, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the current hardcoded lists so nothing is lost on upgrade.
-- INSERT IGNORE + the (kind, name) unique key makes this a no-op on re-runs.
INSERT IGNORE INTO org_config (kind, name) VALUES
  ('department', 'HR'),
  ('department', 'GM Office'),
  ('department', 'CFO Office'),
  ('department', 'Digital Marketing'),
  ('department', 'Marketing'),
  ('department', 'Operation'),
  ('department', 'SEP'),
  ('department', 'DT'),
  ('department', 'Design Team'),
  ('department', 'Back Office'),
  ('department', 'Strategy Team'),
  ('department', 'Others'),
  ('position', 'Administrator'),
  ('position', 'GM'),
  ('position', 'CFO'),
  ('position', 'Assistant GM'),
  ('position', 'Manager'),
  ('position', 'Assistant Manager'),
  ('position', 'Supervisor'),
  ('position', 'Assistant Supervisor'),
  ('position', 'Senior Software Engineer'),
  ('position', 'Frontend Engineer'),
  ('position', 'Backend Engineer'),
  ('position', 'Fullstack Engineer'),
  ('position', 'HR Specialist'),
  ('position', 'HR Officer'),
  ('position', 'Marketing Officer'),
  ('position', 'Digital Marketing Specialist'),
  ('position', 'Account Executive'),
  ('position', 'Graphic Designer'),
  ('position', 'UI/UX Designer'),
  ('position', 'Operations Officer'),
  ('position', 'Finance Officer'),
  ('position', 'IT Specialist'),
  ('position', 'Administrative Officer');
