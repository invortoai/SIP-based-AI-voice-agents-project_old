-- Database Performance Optimization Script for Invorto Voice AI Platform
-- This script contains optimizations for PostgreSQL database performance

-- =====================================================
-- INDEX OPTIMIZATIONS
-- =====================================================

-- Agents table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agents_status_created ON agents(status, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agents_tenant_status ON agents(tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agents_name_gin ON agents USING gin(to_tsvector('english', name));

-- Calls table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_agent_status ON calls(agent_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_status_started ON calls(status, started_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_tenant_status ON calls(tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_duration ON calls(duration) WHERE duration IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_cost ON calls(cost_inr) WHERE cost_inr IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_from_to ON calls(from_num, to_num);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_started_range ON calls(started_at) WHERE started_at >= CURRENT_DATE - INTERVAL '90 days';

-- Timeline events indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_timeline_call_kind ON timeline_events(call_id, kind);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_timeline_timestamp ON timeline_events(timestamp DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_timeline_kind_timestamp ON timeline_events(kind, timestamp DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_timeline_payload_gin ON timeline_events USING gin(payload);

-- Cost calculations indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_call_costs_call_id ON call_costs(call_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_call_costs_calculated ON call_costs(calculated_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_call_costs_total ON call_costs(total_cost);

-- =====================================================
-- PARTITIONING STRATEGY
-- =====================================================

-- Create partitioning for timeline_events (by month)
CREATE TABLE IF NOT EXISTS timeline_events_y2024m12 PARTITION OF timeline_events
    FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

CREATE TABLE IF NOT EXISTS timeline_events_y2025m01 PARTITION OF timeline_events
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- Function to create monthly partitions automatically
CREATE OR REPLACE FUNCTION create_timeline_partition(target_date DATE)
RETURNS VOID AS $$
DECLARE
    partition_name TEXT;
    start_date DATE;
    end_date DATE;
BEGIN
    partition_name := 'timeline_events_y' || to_char(target_date, 'YYYY') || 'm' || to_char(target_date, 'MM');
    start_date := date_trunc('month', target_date);
    end_date := start_date + INTERVAL '1 month';

    -- Check if partition already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = partition_name AND n.nspname = 'public'
    ) THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF timeline_events FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );

        -- Create indexes on partition
        EXECUTE format('CREATE INDEX %I ON %I (call_id, kind)', partition_name || '_idx_call_kind', partition_name);
        EXECUTE format('CREATE INDEX %I ON %I (timestamp DESC)', partition_name || '_idx_timestamp', partition_name);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- QUERY OPTIMIZATIONS
-- =====================================================

-- Create materialized view for call analytics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_call_analytics AS
SELECT
    c.id as call_id,
    c.agent_id,
    c.tenant_id,
    c.status,
    c.started_at,
    c.ended_at,
    c.duration,
    c.cost_inr,
    COUNT(te.id) as total_events,
    COUNT(CASE WHEN te.kind = 'call.answered' THEN 1 END) as answered_events,
    COUNT(CASE WHEN te.kind = 'call.ended' THEN 1 END) as ended_events,
    COUNT(CASE WHEN te.kind = 'stt.final' THEN 1 END) as transcription_events,
    COUNT(CASE WHEN te.kind = 'llm.response' THEN 1 END) as llm_events,
    COUNT(CASE WHEN te.kind LIKE 'error%' THEN 1 END) as error_events,
    AVG(CASE WHEN te.kind = 'quality.metric' THEN (te.payload->>'value')::float END) as avg_quality_score,
    MIN(te.timestamp) as first_event_time,
    MAX(te.timestamp) as last_event_time
FROM calls c
LEFT JOIN timeline_events te ON c.id = te.call_id
WHERE c.started_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY c.id, c.agent_id, c.tenant_id, c.status, c.started_at, c.ended_at, c.duration, c.cost_inr;

-- Create indexes on materialized view
CREATE INDEX IF NOT EXISTS idx_mv_call_analytics_agent ON mv_call_analytics(agent_id);
CREATE INDEX IF NOT EXISTS idx_mv_call_analytics_tenant ON mv_call_analytics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mv_call_analytics_status ON mv_call_analytics(status);
CREATE INDEX IF NOT EXISTS idx_mv_call_analytics_started ON mv_call_analytics(started_at DESC);

-- Function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_call_analytics()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_call_analytics;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- CONNECTION POOLING OPTIMIZATIONS
-- =====================================================

-- Create a function to monitor connection usage
CREATE OR REPLACE FUNCTION get_connection_stats()
RETURNS TABLE (
    total_connections INTEGER,
    active_connections INTEGER,
    idle_connections INTEGER,
    max_connections INTEGER,
    connection_ratio FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT count(*) FROM pg_stat_activity)::INTEGER as total_connections,
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'active')::INTEGER as active_connections,
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle')::INTEGER as idle_connections,
        (SELECT setting::INTEGER FROM pg_settings WHERE name = 'max_connections') as max_connections,
        ROUND(
            (SELECT count(*) FROM pg_stat_activity)::FLOAT /
            (SELECT setting::FLOAT FROM pg_settings WHERE name = 'max_connections'),
            3
        ) as connection_ratio;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- CACHE OPTIMIZATION
-- =====================================================

-- Create a function to analyze and optimize table cache
CREATE OR REPLACE FUNCTION analyze_table_cache()
RETURNS TABLE (
    schemaname TEXT,
    tablename TEXT,
    seq_scan BIGINT,
    idx_scan BIGINT,
    cache_hit_ratio FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        schemaname::TEXT,
        tablename::TEXT,
        seq_scan,
        idx_scan,
        ROUND(
            CASE
                WHEN (heap_blks_hit + heap_blks_read) > 0
                THEN heap_blks_hit::FLOAT / (heap_blks_hit + heap_blks_read)
                ELSE 0
            END,
            3
        ) as cache_hit_ratio
    FROM pg_statio_user_tables
    ORDER BY cache_hit_ratio ASC
    LIMIT 20;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- VACUUM AND MAINTENANCE OPTIMIZATIONS
-- =====================================================

-- Create a comprehensive maintenance function
CREATE OR REPLACE FUNCTION perform_database_maintenance()
RETURNS VOID AS $$
DECLARE
    table_record RECORD;
BEGIN
    -- Analyze all tables
    FOR table_record IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ANALYZE %I.%I', table_record.schemaname, table_record.tablename);
        RAISE NOTICE 'Analyzed table: %.%', table_record.schemaname, table_record.tablename;
    END LOOP;

    -- Vacuum analyze large tables
    FOR table_record IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        AND pg_total_relation_size(schemaname || '.' || tablename) > 100000000  -- 100MB
    LOOP
        EXECUTE format('VACUUM ANALYZE %I.%I', table_record.schemaname, table_record.tablename);
        RAISE NOTICE 'Vacuum analyzed large table: %.%', table_record.schemaname, table_record.tablename;
    END LOOP;

    -- Reindex invalid indexes
    REINDEX (VERBOSE) SYSTEM invorto_db;

    RAISE NOTICE 'Database maintenance completed successfully';
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- MONITORING AND ALERTING FUNCTIONS
-- =====================================================

-- Function to monitor slow queries
CREATE OR REPLACE FUNCTION get_slow_queries(threshold_seconds INTEGER DEFAULT 10)
RETURNS TABLE (
    pid INTEGER,
    duration INTERVAL,
    query TEXT,
    state TEXT,
    wait_event TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        psa.pid,
        psa.query_start - psa.backend_start as duration,
        psa.query,
        psa.state,
        psa.wait_event
    FROM pg_stat_activity psa
    WHERE psa.state = 'active'
    AND psa.query_start IS NOT NULL
    AND extract(epoch from (now() - psa.query_start)) > threshold_seconds
    ORDER BY psa.query_start ASC;
END;
$$ LANGUAGE plpgsql;

-- Function to monitor table bloat
CREATE OR REPLACE FUNCTION get_table_bloat()
RETURNS TABLE (
    schemaname TEXT,
    tablename TEXT,
    bloat_ratio FLOAT,
    wasted_bytes BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        schemaname::TEXT,
        tablename::TEXT,
        CASE
            WHEN n_dead_tup::FLOAT / nullif(n_live_tup, 0) > 0
            THEN round((n_dead_tup::FLOAT / nullif(n_live_tup, 0))::numeric, 2)
            ELSE 0
        END as bloat_ratio,
        n_dead_tup * 100 as wasted_bytes  -- Approximate
    FROM pg_stat_user_tables
    WHERE n_dead_tup > 0
    ORDER BY bloat_ratio DESC
    LIMIT 20;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PERFORMANCE MONITORING VIEWS
-- =====================================================

-- Create a view for real-time performance monitoring
CREATE OR REPLACE VIEW performance_monitoring AS
SELECT
    now() as snapshot_time,
    (SELECT count(*) FROM pg_stat_activity) as total_connections,
    (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
    (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle') as idle_connections,
    (SELECT sum(seq_scan) FROM pg_stat_user_tables) as total_seq_scans,
    (SELECT sum(idx_scan) FROM pg_stat_user_tables) as total_idx_scans,
    (SELECT sum(n_tup_ins) FROM pg_stat_user_tables) as total_inserts,
    (SELECT sum(n_tup_upd) FROM pg_stat_user_tables) as total_updates,
    (SELECT sum(n_tup_del) FROM pg_stat_user_tables) as total_deletes,
    (SELECT sum(n_dead_tup) FROM pg_stat_user_tables) as total_dead_tuples,
    (SELECT sum(blk_read_time) FROM pg_stat_database) as total_blk_read_time,
    (SELECT sum(blk_write_time) FROM pg_stat_database) as total_blk_write_time;

-- =====================================================
-- AUTOMATED MAINTENANCE SCHEDULE
-- =====================================================

-- Create a function to be called by pg_cron for regular maintenance
CREATE OR REPLACE FUNCTION scheduled_maintenance()
RETURNS VOID AS $$
BEGIN
    -- Refresh materialized views
    PERFORM refresh_call_analytics();

    -- Analyze tables
    PERFORM perform_database_maintenance();

    -- Log maintenance completion
    INSERT INTO maintenance_log (operation, completed_at, status)
    VALUES ('scheduled_maintenance', now(), 'completed');
END;
$$ LANGUAGE plpgsql;

-- Create maintenance log table
CREATE TABLE IF NOT EXISTS maintenance_log (
    id SERIAL PRIMARY KEY,
    operation TEXT NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    status TEXT DEFAULT 'completed',
    details JSONB
);

-- Create index on maintenance log
CREATE INDEX IF NOT EXISTS idx_maintenance_log_completed ON maintenance_log(completed_at DESC);

-- =====================================================
-- CONFIGURATION OPTIMIZATIONS
-- =====================================================

-- Recommended PostgreSQL configuration changes
/*
-- Add to postgresql.conf:

# Memory Configuration
shared_buffers = 256MB                    # 25% of RAM
effective_cache_size = 1GB               # 75% of RAM
work_mem = 4MB                           # Per connection
maintenance_work_mem = 64MB              # For maintenance operations

# Checkpoint Configuration
checkpoint_completion_target = 0.9
wal_buffers = 16MB
max_wal_size = 1GB
min_wal_size = 80MB

# Connection Configuration
max_connections = 200                   # Adjust based on needs
tcp_keepalives_idle = 60
tcp_keepalives_interval = 10
tcp_keepalives_count = 3

# Query Planning
random_page_cost = 1.1                  # For SSD storage
effective_io_concurrency = 200

# Logging
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
log_statement = 'ddl'
log_duration = on
log_min_duration_statement = 1000       # Log queries > 1 second

# Autovacuum Configuration
autovacuum = on
autovacuum_max_workers = 3
autovacuum_naptime = 20s
autovacuum_vacuum_threshold = 50
autovacuum_analyze_threshold = 50
autovacuum_vacuum_scale_factor = 0.02
autovacuum_analyze_scale_factor = 0.01
*/

-- =====================================================
-- USAGE EXAMPLES
-- =====================================================

/*
-- Monitor connection usage
SELECT * FROM get_connection_stats();

-- Check slow queries
SELECT * FROM get_slow_queries(5);

-- Analyze table cache efficiency
SELECT * FROM analyze_table_cache();

-- Check table bloat
SELECT * FROM get_table_bloat();

-- View real-time performance
SELECT * FROM performance_monitoring;

-- Manual maintenance
SELECT perform_database_maintenance();

-- Refresh analytics
SELECT refresh_call_analytics();
*/

-- =====================================================
-- END OF OPTIMIZATION SCRIPT
-- =====================================================