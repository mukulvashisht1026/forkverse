CREATE INDEX IF NOT EXISTS sources_published_idx ON sources(published_at DESC);
CREATE INDEX IF NOT EXISTS node_sources_source_idx ON node_sources(source_id);
CREATE INDEX IF NOT EXISTS node_entities_entity_idx ON node_entities(entity_id);
CREATE INDEX IF NOT EXISTS monitors_entity_idx ON monitors(entity_id);
CREATE INDEX IF NOT EXISTS alerts_node_idx ON alerts(node_id);
