-- Keep the original task predicate and meter-key continuation on the same complete valuation source.
CREATE INDEX execution_valuation_task_meter
  ON observability.execution_valuations (task_key, meter_key);
