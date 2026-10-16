create index asset_custody_history_lookup on asset_custody(asset_id,id desc);
create index asset_stock_checks_history_lookup on asset_stock_checks(asset_id,id desc);
create index asset_events_history_lookup on asset_events(asset_id,id desc);
create index asset_disposals_history_lookup on asset_disposals(asset_id,created_at desc,id desc);
