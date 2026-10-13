-- Each original valuation dirties every exact usage match. Bound the lookup
-- work by its indexed identity, never by limiting the matching population.
CREATE INDEX usage_projection_valuation_match ON observability.usage_projections
 (task_key,(document->'identity'),(document->>'sourceId'),(document->>'recordId')) INCLUDE(meter_key);
