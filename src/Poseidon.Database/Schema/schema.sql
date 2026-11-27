-- Poseidon MySQL schema
-- Run once:  mysql -u poseidon -p poseidon < src/Poseidon.Database/Schema/schema.sql

CREATE DATABASE IF NOT EXISTS poseidon CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE poseidon;

-- Reusable Lua scripts that power workflow nodes
CREATE TABLE IF NOT EXISTS scripts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    content LONGTEXT NOT NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY ux_scripts_name (name)
) ENGINE=InnoDB;

-- Workflows (the n8n-like "flow")
CREATE TABLE IF NOT EXISTS workflows (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    definition_json LONGTEXT NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB;

-- Nodes inside a workflow (extends the existing ActionModel idea)
CREATE TABLE IF NOT EXISTS workflow_nodes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workflow_id BIGINT UNSIGNED NOT NULL,
    type VARCHAR(100) NOT NULL,        -- http_request | mysql_query | code | if | wait | ai | ...
    name VARCHAR(255) NOT NULL,
    config_json LONGTEXT,              -- node-specific configuration
    lua_script_id BIGINT UNSIGNED,     -- script executed for this node (code nodes)
    position_x INT NOT NULL DEFAULT 0,
    position_y INT NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY fk_nodes_workflow (workflow_id),
    CONSTRAINT fk_nodes_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
    CONSTRAINT fk_nodes_script FOREIGN KEY (lua_script_id) REFERENCES scripts(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Edges between nodes; carries success/fail routing (IdNext / IdNextFail)
CREATE TABLE IF NOT EXISTS workflow_edges (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workflow_id BIGINT UNSIGNED NOT NULL,
    source_node_id BIGINT UNSIGNED NOT NULL,
    target_node_id BIGINT UNSIGNED NOT NULL,
    condition_type ENUM('always','on_success','on_error','expression') NOT NULL DEFAULT 'always',
    condition_expression VARCHAR(1024), -- Lua expression evaluated against previous output
    PRIMARY KEY (id),
    KEY fk_edges_workflow (workflow_id),
    KEY fk_edges_source (source_node_id),
    KEY fk_edges_target (target_node_id),
    CONSTRAINT fk_edges_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
    CONSTRAINT fk_edges_source FOREIGN KEY (source_node_id) REFERENCES workflow_nodes(id) ON DELETE CASCADE,
    CONSTRAINT fk_edges_target FOREIGN KEY (target_node_id) REFERENCES workflow_nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Workflow execution records
CREATE TABLE IF NOT EXISTS executions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    workflow_id BIGINT UNSIGNED NOT NULL,
    status ENUM('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
    trigger_type VARCHAR(50) NOT NULL DEFAULT 'manual', -- manual | schedule | webhook
    input_json LONGTEXT,
    output_json LONGTEXT,
    error TEXT,
    started_at TIMESTAMP NULL DEFAULT NULL,
    finished_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY fk_executions_workflow (workflow_id),
    CONSTRAINT fk_executions_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Per-node step results inside an execution
CREATE TABLE IF NOT EXISTS execution_steps (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    execution_id BIGINT UNSIGNED NOT NULL,
    node_id BIGINT UNSIGNED NOT NULL,
    status ENUM('queued','running','completed','failed','skipped') NOT NULL DEFAULT 'queued',
    input_json LONGTEXT,
    output_json LONGTEXT,
    error TEXT,
    duration_ms BIGINT,
    started_at TIMESTAMP NULL DEFAULT NULL,
    finished_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY fk_steps_execution (execution_id),
    KEY fk_steps_node (node_id),
    CONSTRAINT fk_steps_execution FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE,
    CONSTRAINT fk_steps_node FOREIGN KEY (node_id) REFERENCES workflow_nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Encrypted credentials (passwords, API keys, …) used by nodes
CREATE TABLE IF NOT EXISTS credentials (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL,          -- mysql | http_basic | api_key | oauth2 | …
    encrypted_json LONGTEXT NOT NULL,    -- AES-256-GCM (CredentialVault)
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY ux_credentials_name (name)
) ENGINE=InnoDB;

-- Audit log for security-relevant events
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_type VARCHAR(100) NOT NULL,
    actor VARCHAR(255),
    ip VARCHAR(64),
    details_json LONGTEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_audit_created (created_at)
) ENGINE=InnoDB;
