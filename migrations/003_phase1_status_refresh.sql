update decisions
set status = 'accepted',
    recommendation = 'PostgreSQL with SQL migrations and seed data'
where decision_id = 'ADR-002';

update decisions
set status = 'proposed',
    recommendation = 'Node modular monolith scaffold with PostgreSQL for Phase 1'
where decision_id = 'ADR-006';

update implementation_tickets
set status = 'done'
where ticket_id in ('FND-0.1', 'FND-0.3');
