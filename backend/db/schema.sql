-- Playwright Dashboard Database Schema
-- Run this in Neon to create the required tables

-- Test runs table - stores each test run
CREATE TABLE IF NOT EXISTS test_runs (
    id SERIAL PRIMARY KEY,
    project_id VARCHAR(100) NOT NULL,
    run_id VARCHAR(50) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stats_total INTEGER NOT NULL DEFAULT 0,
    stats_passed INTEGER NOT NULL DEFAULT 0,
    stats_failed INTEGER NOT NULL DEFAULT 0,
    stats_skipped INTEGER NOT NULL DEFAULT 0,
    stats_duration INTEGER NOT NULL DEFAULT 0,
    source VARCHAR(50) DEFAULT 'ci-upload',
    exit_code INTEGER DEFAULT 0,
    suites JSONB DEFAULT '[]'::jsonb,
    errors JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by project
CREATE INDEX IF NOT EXISTS idx_test_runs_project_id ON test_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_timestamp ON test_runs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_test_runs_project_timestamp ON test_runs(project_id, timestamp DESC);

-- Projects table - stores project metadata
CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    base_url VARCHAR(500),
    port INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default projects
INSERT INTO projects (id, name, base_url, port) VALUES
    ('rental', 'Rental Platform', 'https://rental.exe.pm', 3002),
    ('crossfit-generator', 'WODForge', 'https://crossfit.exe.pm', 3000),
    ('calify', 'Calify', 'https://calify.exe.pm', 3020),
    ('kanban', 'Kanban Board', 'https://kanban.exe.pm', 3010),
    ('grablist', 'Grablist', 'https://grablist.exe.pm', 3040),
    ('sorring3d', 'Sorring 3D', 'https://sorring3d.exe.pm', 3050)
ON CONFLICT (id) DO NOTHING;
