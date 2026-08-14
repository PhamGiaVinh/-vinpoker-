import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { contractError } from "../contracts/validator.js";
import { sha256, stableStringify } from "../lib/stable-json.js";

const DEFAULT_LEASE_SECONDS = 90;
const MAX_LEASE_SECONDS = 10 * 60;

export class SqliteAutomationStore {
  constructor({ dbPath, now = () => Date.now() }) {
    this.dbPath = dbPath;
    this.now = now;
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.initialize();
  }

  initialize() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS clubs (
        club_id TEXT PRIMARY KEY,
        display_code TEXT NOT NULL,
        timezone TEXT NOT NULL,
        mock_owner_endpoint_id TEXT NOT NULL UNIQUE,
        mock_owner_enabled INTEGER NOT NULL DEFAULT 1,
        snapshot_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS canonical_fixture_state (
        entity_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        club_id TEXT,
        scope_key TEXT NOT NULL,
        workflow_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        priority INTEGER NOT NULL,
        status TEXT NOT NULL,
        available_at TEXT NOT NULL,
        expires_at TEXT,
        catch_up_policy TEXT NOT NULL,
        lease_token TEXT,
        lease_until TEXT,
        lease_max_until TEXT,
        worker_id TEXT,
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 8,
        next_attempt_at TEXT,
        last_error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(scope_key, event_type, dedupe_key)
      );
      CREATE INDEX IF NOT EXISTS idx_events_claim
        ON events(workflow_key, status, available_at, priority DESC);
      CREATE INDEX IF NOT EXISTS idx_events_club_status
        ON events(club_id, workflow_key, status);

      CREATE TABLE IF NOT EXISTS event_attempts (
        attempt_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(event_id),
        attempt INTEGER NOT NULL,
        lease_token TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        outcome TEXT,
        error_code TEXT
      );

      CREATE TABLE IF NOT EXISTS dead_letters (
        dead_letter_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE REFERENCES events(event_id),
        error_code TEXT NOT NULL,
        failed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS content_artifacts (
        artifact_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE REFERENCES events(event_id),
        club_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        artifact_json TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notification_requests (
        notification_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        event_id TEXT NOT NULL REFERENCES events(event_id),
        logical_key TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL,
        request_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notification_deliveries (
        delivery_id TEXT PRIMARY KEY,
        notification_id TEXT NOT NULL REFERENCES notification_requests(notification_id),
        event_id TEXT NOT NULL REFERENCES events(event_id),
        delivery_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS worker_heartbeats (
        worker_id TEXT NOT NULL,
        workflow_key TEXT NOT NULL,
        environment TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY(worker_id, workflow_key, environment)
      );

      CREATE TABLE IF NOT EXISTS hmac_nonces (
        key_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        PRIMARY KEY(key_id, nonce)
      );

      CREATE TABLE IF NOT EXISTS rate_limits (
        bucket_key TEXT NOT NULL,
        window_id INTEGER NOT NULL,
        request_count INTEGER NOT NULL,
        PRIMARY KEY(bucket_key, window_id)
      );

      CREATE TABLE IF NOT EXISTS kill_switches (
        scope TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        reason_code TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(scope, scope_key)
      );

      CREATE TABLE IF NOT EXISTS claim_cursors (
        workflow_key TEXT PRIMARY KEY,
        last_club_id TEXT,
        updated_at TEXT NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  transaction(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  resetFixtures() {
    this.transaction(() => {
      this.db.exec(`
        DELETE FROM notification_deliveries;
        DELETE FROM notification_requests;
        DELETE FROM content_artifacts;
        DELETE FROM dead_letters;
        DELETE FROM event_attempts;
        DELETE FROM events;
        DELETE FROM clubs;
        DELETE FROM canonical_fixture_state;
        DELETE FROM worker_heartbeats;
        DELETE FROM hmac_nonces;
        DELETE FROM rate_limits;
        DELETE FROM kill_switches;
        DELETE FROM claim_cursors;
      `);
    });
  }

  upsertClubFixture(club) {
    const now = this.isoNow();
    this.db
      .prepare(`
        INSERT INTO clubs (
          club_id, display_code, timezone, mock_owner_endpoint_id,
          mock_owner_enabled, snapshot_json, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(club_id) DO UPDATE SET
          display_code = excluded.display_code,
          timezone = excluded.timezone,
          mock_owner_endpoint_id = excluded.mock_owner_endpoint_id,
          mock_owner_enabled = 1,
          snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at
      `)
      .run(
        club.club_id,
        club.display_code,
        club.timezone,
        club.mock_owner_endpoint_id,
        stableStringify(club.canonical_snapshot),
        now,
      );
  }

  getClubFixture(clubId) {
    const row = this.db
      .prepare("SELECT * FROM clubs WHERE club_id = ?")
      .get(clubId);
    if (!row) return null;
    return { ...row, canonical_snapshot: JSON.parse(row.snapshot_json) };
  }

  insertScheduledEvent(event, workflowKey = "owner.daily_digest.v1") {
    return this.transaction(() => this.insertEventRow(event, workflowKey));
  }

  simulateCanonicalWrite({ entityId, state, event, failOutbox = false }) {
    return this.transaction(() => {
      const now = this.isoNow();
      this.db
        .prepare(`
          INSERT INTO canonical_fixture_state(entity_id, state_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(entity_id) DO UPDATE SET
            state_json = excluded.state_json,
            updated_at = excluded.updated_at
        `)
        .run(entityId, stableStringify(state), now);

      if (failOutbox) {
        throw contractError("SIMULATED_OUTBOX_FAILURE", "Simulated outbox insert failure");
      }
      return this.insertEventRow(event, "fixture.domain.v1");
    });
  }

  getCanonicalFixtureState(entityId) {
    const row = this.db
      .prepare("SELECT state_json FROM canonical_fixture_state WHERE entity_id = ?")
      .get(entityId);
    return row ? JSON.parse(row.state_json) : null;
  }

  insertEventRow(event, workflowKey) {
    const now = this.isoNow();
    try {
      const result = this.db
        .prepare(`
          INSERT INTO events (
            event_id, club_id, scope_key, workflow_key, event_type, schema_version, event_json,
            dedupe_key, priority, status, available_at, expires_at, catch_up_policy,
            attempt, max_attempts, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, 0, 8, ?, ?)
        `)
        .run(
          event.event_id,
          event.scope.kind === "CLUB" ? event.scope.club_id : null,
          event.scope.kind === "CLUB" ? `CLUB:${event.scope.club_id}` : "PLATFORM",
          workflowKey,
          event.event_type,
          event.schema_version,
          stableStringify(event),
          event.dedupe_key,
          event.priority,
          event.available_at,
          event.expires_at ?? null,
          event.catch_up_policy,
          now,
          now,
        );
      return { eventId: event.event_id, inserted: result.changes === 1 };
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed")) {
        const existing = this.db
          .prepare(`
            SELECT event_id, event_json FROM events
            WHERE scope_key = ? AND event_type = ? AND dedupe_key = ?
          `)
          .get(
            event.scope.kind === "CLUB" ? `CLUB:${event.scope.club_id}` : "PLATFORM",
            event.event_type,
            event.dedupe_key,
          );
        if (existing && sha256(existing.event_json) === sha256(stableStringify(event))) {
          return { eventId: existing.event_id, inserted: false };
        }
        throw contractError(
          "PRODUCER_IDEMPOTENCY_CONFLICT",
          "Dedupe key was reused with different event content",
        );
      }
      throw error;
    }
  }

  claim({
    workflowKey,
    workerId,
    batchSize = 20,
    leaseSeconds = DEFAULT_LEASE_SECONDS,
    orderingPolicy = "PROCESS_ALL",
  }) {
    const boundedBatch = Math.min(Math.max(batchSize, 1), 50);
    const boundedLease = Math.min(Math.max(leaseSeconds, 30), DEFAULT_LEASE_SECONDS);
    const nowMs = this.now();
    const now = new Date(nowMs).toISOString();

    return this.transaction(() => {
      this.releaseExpiredLeases(now);
      this.skipExpiredEvents(now);
      if (orderingPolicy === "LATEST_ONLY") {
        this.skipSupersededLatestOnly(workflowKey, now);
      }

      const clubRows = this.db
        .prepare(`
          SELECT DISTINCT club_id
          FROM events
          WHERE workflow_key = ?
            AND status = 'PENDING'
            AND available_at <= ?
            AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            AND (expires_at IS NULL OR expires_at > ?)
            AND attempt < max_attempts
            AND club_id IS NOT NULL
          ORDER BY club_id
        `)
        .all(workflowKey, now, now, now);
      const clubIds = clubRows.map((row) => row.club_id);
      if (clubIds.length === 0) return [];

      const cursor = this.db
        .prepare("SELECT last_club_id FROM claim_cursors WHERE workflow_key = ?")
        .get(workflowKey)?.last_club_id;
      const rotatedClubs = rotateAfter(clubIds, cursor);
      const candidateQueues = new Map();

      for (const clubId of rotatedClubs) {
        const active = this.db
          .prepare(`
            SELECT COUNT(*) AS count
            FROM events
            WHERE workflow_key = ? AND club_id = ? AND status = 'LEASED' AND lease_until > ?
          `)
          .get(workflowKey, clubId, now).count;
        const slots = Math.max(0, 2 - Number(active));
        if (slots === 0) continue;
        const rows = this.db
          .prepare(`
            SELECT event_id
            FROM events
            WHERE workflow_key = ?
              AND club_id = ?
              AND status = 'PENDING'
              AND available_at <= ?
              AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
              AND (expires_at IS NULL OR expires_at > ?)
              AND attempt < max_attempts
            ORDER BY priority DESC, available_at ASC, created_at ASC, event_id ASC
            LIMIT ?
          `)
          .all(workflowKey, clubId, now, now, now, slots);
        if (rows.length) candidateQueues.set(clubId, rows.map((row) => row.event_id));
      }

      const selected = [];
      while (selected.length < boundedBatch) {
        let advanced = false;
        for (const clubId of rotatedClubs) {
          const queue = candidateQueues.get(clubId);
          if (!queue?.length || selected.length >= boundedBatch) continue;
          selected.push({ clubId, eventId: queue.shift() });
          advanced = true;
        }
        if (!advanced) break;
      }

      const claimed = [];
      for (const selection of selected) {
        const leaseToken = randomUUID();
        const leaseUntil = new Date(nowMs + boundedLease * 1000).toISOString();
        const leaseMaxUntil = new Date(nowMs + MAX_LEASE_SECONDS * 1000).toISOString();
        const update = this.db
          .prepare(`
            UPDATE events
            SET status = 'LEASED',
                lease_token = ?,
                lease_until = ?,
                lease_max_until = ?,
                worker_id = ?,
                attempt = attempt + 1,
                updated_at = ?
            WHERE event_id = ? AND status = 'PENDING'
          `)
          .run(
            leaseToken,
            leaseUntil,
            leaseMaxUntil,
            workerId,
            now,
            selection.eventId,
          );
        if (update.changes !== 1) continue;

        const row = this.db
          .prepare("SELECT * FROM events WHERE event_id = ?")
          .get(selection.eventId);
        this.db
          .prepare(`
            INSERT INTO event_attempts (
              attempt_id, event_id, attempt, lease_token, worker_id, started_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `)
          .run(randomUUID(), row.event_id, row.attempt, leaseToken, workerId, now);
        claimed.push(this.claimEnvelope(row));
      }

      const lastClubId = claimed.at(-1)?.event?.scope?.club_id ?? cursor ?? null;
      this.db
        .prepare(`
          INSERT INTO claim_cursors(workflow_key, last_club_id, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(workflow_key) DO UPDATE SET
            last_club_id = excluded.last_club_id,
            updated_at = excluded.updated_at
        `)
        .run(workflowKey, lastClubId, now);
      return claimed;
    });
  }

  preflight({ eventId, leaseToken, workerId, workflowKey }) {
    const row = this.assertActiveLease(eventId, leaseToken, workerId, workflowKey);
    const event = JSON.parse(row.event_json);
    if (event.severity === "P0") {
      throw contractError("P0_NATIVE_ONLY", "P0 is not claimable by n8n");
    }
    if (row.expires_at && Date.parse(row.expires_at) <= this.now()) {
      this.markSkipped(eventId, leaseToken, "EXPIRED");
      throw contractError("EVENT_EXPIRED", "Event expired before preflight");
    }
    if (this.isKillSwitchEnabled("GLOBAL", "*")) {
      throw contractError("GLOBAL_KILL_SWITCH", "Global automation kill switch is enabled");
    }
    if (this.isKillSwitchEnabled("WORKFLOW", row.workflow_key)) {
      throw contractError("WORKFLOW_KILL_SWITCH", "Workflow kill switch is enabled");
    }
    if (row.club_id && this.isKillSwitchEnabled("CLUB", row.club_id)) {
      throw contractError("CLUB_KILL_SWITCH", "Club automation kill switch is enabled");
    }
    return this.claimEnvelope(row);
  }

  heartbeat({ eventId, leaseToken, workerId, workflowKey, environment }) {
    return this.transaction(() => {
      const nowMs = this.now();
      const row = this.assertActiveLease(eventId, leaseToken, workerId, workflowKey);
      const maxMs = Date.parse(row.lease_max_until);
      const nextLeaseUntil = new Date(
        Math.min(nowMs + DEFAULT_LEASE_SECONDS * 1000, maxMs),
      ).toISOString();
      if (Date.parse(nextLeaseUntil) <= nowMs) {
        throw contractError("LEASE_EXTENSION_LIMIT", "Lease reached its maximum lifetime");
      }
      const result = this.db
        .prepare(`
          UPDATE events SET lease_until = ?, updated_at = ?
          WHERE event_id = ? AND lease_token = ? AND worker_id = ? AND status = 'LEASED'
        `)
        .run(nextLeaseUntil, this.isoNow(), eventId, leaseToken, workerId);
      if (result.changes !== 1) {
        throw contractError("CLAIM_LOST", "Lease changed while extending heartbeat");
      }
      this.recordWorkerHeartbeat({ workerId, workflowKey, environment });
      return { lease_until: nextLeaseUntil };
    });
  }

  complete({ eventId, leaseToken, workerId, workflowKey, notificationId }) {
    return this.transaction(() => {
      const row = this.assertActiveLease(eventId, leaseToken, workerId, workflowKey);
      const leaseWorkerId = workerId ?? row.worker_id;
      const notification = this.db
        .prepare(`
          SELECT notification_id FROM notification_requests
          WHERE notification_id = ? AND event_id = ?
        `)
        .get(notificationId, eventId);
      if (!notification) {
        throw contractError(
          "DURABLE_ENQUEUE_REQUIRED",
          "Event cannot complete before durable notification enqueue",
        );
      }
      const now = this.isoNow();
      const result = this.db
        .prepare(`
          UPDATE events
          SET status = 'COMPLETED', lease_token = NULL, lease_until = NULL,
              lease_max_until = NULL, worker_id = NULL, updated_at = ?
          WHERE event_id = ? AND status = 'LEASED' AND lease_token = ? AND worker_id = ?
        `)
        .run(now, eventId, leaseToken, leaseWorkerId);
      if (result.changes !== 1) {
        throw contractError("CLAIM_LOST", "Lease is no longer active");
      }
      this.finishAttempt(row, "COMPLETED", null);
      return { event_id: eventId, status: "COMPLETED" };
    });
  }

  fail({ eventId, leaseToken, workerId, workflowKey, errorCode, retryable }) {
    return this.transaction(() => {
      const row = this.assertActiveLease(eventId, leaseToken, workerId, workflowKey);
      const nowMs = this.now();
      const now = new Date(nowMs).toISOString();
      const canRetry = retryable && row.attempt < row.max_attempts;
      if (canRetry) {
        const delaySeconds = deterministicBackoffSeconds(eventId, row.attempt);
        const nextAttempt = new Date(nowMs + delaySeconds * 1000).toISOString();
        const result = this.db
          .prepare(`
            UPDATE events
            SET status = 'PENDING', lease_token = NULL, lease_until = NULL,
                lease_max_until = NULL, worker_id = NULL, next_attempt_at = ?,
                last_error_code = ?, updated_at = ?
            WHERE event_id = ? AND lease_token = ? AND worker_id = ? AND status = 'LEASED'
          `)
          .run(nextAttempt, errorCode, now, eventId, leaseToken, workerId);
        if (result.changes !== 1) throw contractError("CLAIM_LOST", "Lease is no longer active");
        this.finishAttempt(row, "RETRY_WAIT", errorCode);
        return { event_id: eventId, status: "RETRY_WAIT", next_attempt_at: nextAttempt };
      }

      this.deadLetter(row, errorCode);
      this.finishAttempt(row, "DEAD_LETTER", errorCode);
      return { event_id: eventId, status: "DEAD_LETTER" };
    });
  }

  saveArtifact({ eventId, leaseToken, workerId, workflowKey, artifact }) {
    return this.transaction(() => {
      const eventRow = this.assertActiveLease(eventId, leaseToken, workerId, workflowKey);
      const existing = this.db
        .prepare("SELECT artifact_json FROM content_artifacts WHERE event_id = ?")
        .get(eventId);
      if (existing) return { artifact: JSON.parse(existing.artifact_json), created: false };

      if (eventRow.club_id !== artifact.club_id) {
        throw contractError("CROSS_SCOPE_REFERENCE", "Artifact club does not match event");
      }
      const now = this.isoNow();
      this.db
        .prepare(`
          INSERT INTO content_artifacts (
            artifact_id, event_id, club_id, artifact_type, artifact_json,
            content_sha256, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          artifact.artifact_id,
          eventId,
          artifact.club_id,
          artifact.artifact_type,
          stableStringify(artifact),
          artifact.content_sha256,
          artifact.expires_at,
          now,
        );
      return { artifact, created: true };
    });
  }

  getArtifact(artifactId) {
    const row = this.db
      .prepare("SELECT artifact_json FROM content_artifacts WHERE artifact_id = ?")
      .get(artifactId);
    return row ? JSON.parse(row.artifact_json) : null;
  }

  getArtifactForEvent(eventId) {
    const row = this.db
      .prepare("SELECT artifact_json FROM content_artifacts WHERE event_id = ?")
      .get(eventId);
    return row ? JSON.parse(row.artifact_json) : null;
  }

  enqueueNotification({
    eventId,
    leaseToken,
    workerId,
    workflowKey,
    request,
    delivery,
    logicalKey,
  }) {
    return this.transaction(() => {
      this.assertActiveLease(eventId, leaseToken, workerId, workflowKey);
      const requestHash = sha256(request);
      const existing = this.db
        .prepare(`
          SELECT notification_id, request_hash
          FROM notification_requests
          WHERE logical_key = ?
        `)
        .get(logicalKey);
      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw contractError(
            "ENQUEUE_IDEMPOTENCY_CONFLICT",
            "Logical notification key was reused with different content",
          );
        }
        return { notificationId: existing.notification_id, created: false };
      }

      const now = this.isoNow();
      const notificationId = delivery.notification_id;
      this.db
        .prepare(`
          INSERT INTO notification_requests (
            notification_id, request_id, event_id, logical_key,
            request_hash, request_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          notificationId,
          request.request_id,
          eventId,
          logicalKey,
          requestHash,
          stableStringify(request),
          now,
        );
      this.db
        .prepare(`
          INSERT INTO notification_deliveries (
            delivery_id, notification_id, event_id, delivery_json,
            status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          delivery.delivery_id,
          notificationId,
          eventId,
          stableStringify(delivery),
          delivery.status,
          now,
          now,
        );
      return { notificationId, created: true };
    });
  }

  resolveMockOwnerEndpoint(clubId) {
    const row = this.db
      .prepare(`
        SELECT mock_owner_endpoint_id, mock_owner_enabled
        FROM clubs WHERE club_id = ?
      `)
      .get(clubId);
    if (!row || !row.mock_owner_enabled) {
      throw contractError("RECIPIENT_POLICY_EMPTY", "No active mock owner endpoint");
    }
    return row.mock_owner_endpoint_id;
  }

  revokeMockOwnerEndpoint(clubId) {
    this.db
      .prepare("UPDATE clubs SET mock_owner_enabled = 0, updated_at = ? WHERE club_id = ?")
      .run(this.isoNow(), clubId);
  }

  getEvent(eventId) {
    const row = this.db
      .prepare("SELECT * FROM events WHERE event_id = ?")
      .get(eventId);
    return row ? { ...row, event: JSON.parse(row.event_json) } : null;
  }

  getNotification(notificationId) {
    const row = this.db
      .prepare(`
        SELECT request_json FROM notification_requests WHERE notification_id = ?
      `)
      .get(notificationId);
    return row ? JSON.parse(row.request_json) : null;
  }

  getDeliveryForNotification(notificationId) {
    const row = this.db
      .prepare(`
        SELECT delivery_json FROM notification_deliveries WHERE notification_id = ?
      `)
      .get(notificationId);
    return row ? JSON.parse(row.delivery_json) : null;
  }

  getDelivery(deliveryId) {
    const row = this.db
      .prepare("SELECT delivery_json FROM notification_deliveries WHERE delivery_id = ?")
      .get(deliveryId);
    return row ? JSON.parse(row.delivery_json) : null;
  }

  claimMockDelivery({ leaseSeconds = DEFAULT_LEASE_SECONDS, validateDelivery }) {
    const boundedLease = Math.min(Math.max(leaseSeconds, 30), DEFAULT_LEASE_SECONDS);
    return this.transaction(() => {
      const nowMs = this.now();
      const now = new Date(nowMs).toISOString();
      this.releaseExpiredMockDeliveryLeases(now, validateDelivery);
      const eligible = this.db
        .prepare(`
          SELECT delivery_id, delivery_json
          FROM notification_deliveries
          WHERE status IN ('QUEUED', 'RETRY_WAIT')
          ORDER BY created_at, delivery_id
        `)
        .all()
        .map((row) => ({ ...row, delivery: JSON.parse(row.delivery_json) }))
        .filter(
          (row) =>
            row.delivery.status === "QUEUED" ||
            Date.parse(row.delivery.next_attempt_at) <= nowMs,
        );
      const candidate = eligible.at(0);
      if (!candidate) return null;
      const delivery = {
        ...candidate.delivery,
        status: "LEASED",
        provider_lease_token: randomUUID(),
        provider_lease_until: new Date(nowMs + boundedLease * 1000).toISOString(),
        row_version: candidate.delivery.row_version + 1,
        updated_at: now,
      };
      delete delivery.next_attempt_at;
      delete delivery.error;
      validateDelivery(delivery);
      this.writeDelivery(delivery);
      return delivery;
    });
  }

  dispatchMockDelivery({ deliveryId, providerLeaseToken, outcome, validateDelivery }) {
    return this.transaction(() => {
      const row = this.getDeliveryRow(deliveryId);
      const nowMs = this.now();
      const now = new Date(nowMs).toISOString();
      this.assertMockDeliveryLease(row.delivery, providerLeaseToken, nowMs);
      const delivery = {
        ...row.delivery,
        attempt_count: row.delivery.attempt_count + 1,
        last_attempt_at: now,
        row_version: row.delivery.row_version + 1,
        updated_at: now,
      };
      delete delivery.provider_lease_token;
      delete delivery.provider_lease_until;
      delete delivery.next_attempt_at;
      delete delivery.error;
      delete delivery.reconciliation;
      delete delivery.unknown_since;
      delete delivery.provider_reference;
      delete delivery.sent_at;
      delete delivery.delivered_at;

      if (outcome === "SENT") {
        delivery.status = "SENT";
        delivery.provider_reference = `mock:${delivery.delivery_id}`;
        delivery.sent_at = now;
      } else if (outcome === "RETRYABLE_FAILURE") {
        if (delivery.attempt_count >= delivery.max_attempts) {
          delivery.status = "PERMANENT_FAILED";
          delivery.error = {
            class: "TRANSIENT",
            code: "MOCK_RETRY_EXHAUSTED",
            retryable: false,
          };
        } else {
          delivery.status = "RETRY_WAIT";
          delivery.error = {
            class: "TRANSIENT",
            code: "MOCK_TRANSIENT",
            retryable: true,
          };
          delivery.next_attempt_at = new Date(
            nowMs + deterministicBackoffSeconds(delivery.delivery_id, delivery.attempt_count) * 1000,
          ).toISOString();
        }
      } else if (outcome === "UNKNOWN") {
        delivery.status = "UNKNOWN";
        delivery.unknown_since = now;
        delivery.reconciliation = {
          state: "PENDING",
          reason: "TIMEOUT_AFTER_SUBMIT",
        };
      } else {
        throw contractError("MOCK_DISPATCH_OUTCOME_INVALID", "Unsupported mock dispatch outcome");
      }
      validateDelivery(delivery);
      this.writeDelivery(delivery);
      return delivery;
    });
  }

  reconcileMockDelivery({ deliveryId, outcome, validateDelivery }) {
    return this.transaction(() => {
      const row = this.getDeliveryRow(deliveryId);
      if (
        row.delivery.status !== "UNKNOWN" ||
        row.delivery.reconciliation?.state !== "PENDING"
      ) {
        throw contractError("RECONCILIATION_NOT_PENDING", "Delivery does not require reconciliation");
      }
      if (!["CONFIRMED_SENT", "CONFIRMED_NOT_SENT"].includes(outcome)) {
        throw contractError("RECONCILIATION_OUTCOME_INVALID", "Unsupported reconciliation outcome");
      }
      const now = this.isoNow();
      const delivery = {
        ...row.delivery,
        status: "RECONCILED",
        row_version: row.delivery.row_version + 1,
        updated_at: now,
        reconciliation: {
          ...row.delivery.reconciliation,
          state: "RESOLVED",
          outcome,
          resolution_source: "PROVIDER_LOOKUP",
          checked_at: now,
          evidence_code: "MOCK_PROVIDER_LOOKUP",
        },
      };
      delete delivery.unknown_since;
      if (outcome === "CONFIRMED_SENT") {
        delivery.provider_reference = `mock:${delivery.delivery_id}`;
        delivery.sent_at = now;
      }
      validateDelivery(delivery);
      this.writeDelivery(delivery);
      return delivery;
    });
  }

  queueMockReplacement({ deliveryId, validateDelivery }) {
    return this.transaction(() => {
      const row = this.getDeliveryRow(deliveryId);
      const source = row.delivery;
      if (
        source.status !== "RECONCILED" ||
        source.reconciliation?.outcome !== "CONFIRMED_NOT_SENT" ||
        source.reconciliation?.superseded_by_delivery_id
      ) {
        throw contractError(
          "REPLACEMENT_NOT_ALLOWED",
          "Only reconciled confirmed-not-sent delivery may be replaced once",
        );
      }
      const now = this.isoNow();
      const replacement = {
        ...source,
        delivery_id: randomUUID(),
        provider_idempotency_key: sha256(`${source.provider_idempotency_key}:replacement`),
        status: "QUEUED",
        attempt_count: 0,
        row_version: 0,
        replaces_delivery_id: source.delivery_id,
        created_at: now,
        updated_at: now,
      };
      delete replacement.provider_reference;
      delete replacement.sent_at;
      delete replacement.delivered_at;
      delete replacement.last_attempt_at;
      delete replacement.provider_lease_token;
      delete replacement.provider_lease_until;
      delete replacement.next_attempt_at;
      delete replacement.error;
      delete replacement.reconciliation;
      delete replacement.unknown_since;
      validateDelivery(replacement);

      const sourceUpdated = {
        ...source,
        row_version: source.row_version + 1,
        updated_at: now,
        reconciliation: {
          ...source.reconciliation,
          superseded_by_delivery_id: replacement.delivery_id,
        },
      };
      validateDelivery(sourceUpdated);
      this.writeDelivery(sourceUpdated);
      this.db
        .prepare(`
          INSERT INTO notification_deliveries (
            delivery_id, notification_id, event_id, delivery_json,
            status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          replacement.delivery_id,
          replacement.notification_id,
          replacement.event_id,
          stableStringify(replacement),
          replacement.status,
          now,
          now,
        );
      return replacement;
    });
  }

  recordWorkerHeartbeat({ workerId, workflowKey, environment }) {
    const now = this.isoNow();
    this.db
      .prepare(`
        INSERT INTO worker_heartbeats(worker_id, workflow_key, environment, last_seen_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(worker_id, workflow_key, environment) DO UPDATE SET
          last_seen_at = excluded.last_seen_at
      `)
      .run(workerId, workflowKey, environment, now);
  }

  consumeNonce({ keyId, nonce, expiresAt }) {
    const now = this.isoNow();
    this.db.prepare("DELETE FROM hmac_nonces WHERE expires_at <= ?").run(now);
    try {
      this.db
        .prepare("INSERT INTO hmac_nonces(key_id, nonce, expires_at) VALUES (?, ?, ?)")
        .run(keyId, nonce, expiresAt);
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed")) {
        throw contractError("HMAC_REPLAY_DETECTED", "HMAC nonce was already used");
      }
      throw error;
    }
  }

  consumeRateLimit({ bucketKey, limit, nowMs }) {
    const windowId = Math.floor(nowMs / 60000);
    const row = this.db
      .prepare(`
        SELECT request_count FROM rate_limits
        WHERE bucket_key = ? AND window_id = ?
      `)
      .get(bucketKey, windowId);
    if (row && row.request_count >= limit) {
      throw contractError("RATE_LIMITED", "Automation worker rate limit exceeded");
    }
    this.db
      .prepare(`
        INSERT INTO rate_limits(bucket_key, window_id, request_count)
        VALUES (?, ?, 1)
        ON CONFLICT(bucket_key, window_id) DO UPDATE SET
          request_count = request_count + 1
      `)
      .run(bucketKey, windowId);
    this.db
      .prepare("DELETE FROM rate_limits WHERE window_id < ?")
      .run(windowId - 2);
  }

  setKillSwitch({ scope, scopeKey = "*", enabled, reasonCode = "DEV_OPERATOR" }) {
    if (!["GLOBAL", "WORKFLOW", "CLUB"].includes(scope)) {
      throw contractError("INVALID_KILL_SWITCH_SCOPE", "Unknown kill switch scope");
    }
    const now = this.isoNow();
    this.db
      .prepare(`
        INSERT INTO kill_switches(scope, scope_key, enabled, reason_code, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(scope, scope_key) DO UPDATE SET
          enabled = excluded.enabled,
          reason_code = excluded.reason_code,
          updated_at = excluded.updated_at
      `)
      .run(scope, scopeKey, enabled ? 1 : 0, reasonCode, now);
    return { scope, scope_key: scopeKey, enabled: Boolean(enabled), updated_at: now };
  }

  isKillSwitchEnabled(scope, scopeKey) {
    const row = this.db
      .prepare(`
        SELECT enabled FROM kill_switches WHERE scope = ? AND scope_key = ?
      `)
      .get(scope, scopeKey);
    return Boolean(row?.enabled);
  }

  status() {
    const now = this.now();
    const counts = Object.fromEntries(
      this.db
        .prepare("SELECT status, COUNT(*) AS count FROM events GROUP BY status")
        .all()
        .map((row) => [row.status, Number(row.count)]),
    );
    const oldest = this.db
      .prepare(`
        SELECT MIN(available_at) AS oldest FROM events
        WHERE status IN ('PENDING', 'LEASED')
      `)
      .get().oldest;
    const heartbeats = this.db
      .prepare(`
        SELECT worker_id, workflow_key, environment, last_seen_at
        FROM worker_heartbeats ORDER BY last_seen_at DESC
      `)
      .all();
    const switches = this.db
      .prepare(`
        SELECT scope, scope_key, enabled, reason_code, updated_at
        FROM kill_switches ORDER BY scope, scope_key
      `)
      .all()
      .map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
    const artifactCount = Number(
      this.db.prepare("SELECT COUNT(*) AS count FROM content_artifacts").get().count,
    );
    const notificationCount = Number(
      this.db.prepare("SELECT COUNT(*) AS count FROM notification_requests").get().count,
    );
    return {
      counts,
      backlog_count: (counts.PENDING ?? 0) + (counts.LEASED ?? 0),
      oldest_event_age_seconds: oldest
        ? Math.max(0, Math.floor((now - Date.parse(oldest)) / 1000))
        : 0,
      dead_letter_count: counts.DEAD_LETTER ?? 0,
      artifact_count: artifactCount,
      notification_count: notificationCount,
      heartbeats,
      kill_switches: switches,
    };
  }

  trace(traceId) {
    const events = this.db
      .prepare(`
        SELECT event_id, event_type, club_id, workflow_key, status, attempt,
               available_at, lease_until, last_error_code, created_at, updated_at,
               event_json
        FROM events ORDER BY created_at, event_id
      `)
      .all()
      .filter((row) => {
        const event = JSON.parse(row.event_json);
        return event.correlation_id === traceId || event.event_id === traceId;
      })
      .map(({ event_json: _eventJson, ...row }) => row);
    return { trace_id: traceId, events };
  }

  shadowEvidence() {
    return this.db
      .prepare(`
        SELECT e.event_json, e.status AS event_status, e.attempt,
               a.artifact_json, n.notification_id, d.delivery_json
        FROM events e
        LEFT JOIN content_artifacts a ON a.event_id = e.event_id
        LEFT JOIN notification_requests n ON n.event_id = e.event_id
        LEFT JOIN notification_deliveries d ON d.event_id = e.event_id
        WHERE e.event_type = 'owner.daily_digest.snapshot_created'
        ORDER BY e.club_id
      `)
      .all()
      .map((row) => ({
        event: JSON.parse(row.event_json),
        event_status: row.event_status,
        attempt: Number(row.attempt),
        artifact: row.artifact_json ? JSON.parse(row.artifact_json) : null,
        notification_id: row.notification_id ?? null,
        delivery: row.delivery_json ? JSON.parse(row.delivery_json) : null,
      }));
  }

  count(tableName) {
    const allowlist = new Set([
      "clubs",
      "canonical_fixture_state",
      "events",
      "event_attempts",
      "dead_letters",
      "content_artifacts",
      "notification_requests",
      "notification_deliveries",
      "worker_heartbeats",
      "hmac_nonces",
    ]);
    if (!allowlist.has(tableName)) throw new Error("Table not allowlisted");
    return Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count);
  }

  getDeliveryRow(deliveryId) {
    const row = this.db
      .prepare("SELECT delivery_id, delivery_json FROM notification_deliveries WHERE delivery_id = ?")
      .get(deliveryId);
    if (!row) throw contractError("DELIVERY_NOT_FOUND", "Delivery does not exist");
    return { ...row, delivery: JSON.parse(row.delivery_json) };
  }

  writeDelivery(delivery) {
    const result = this.db
      .prepare(`
        UPDATE notification_deliveries
        SET delivery_json = ?, status = ?, updated_at = ?
        WHERE delivery_id = ?
      `)
      .run(
        stableStringify(delivery),
        delivery.status,
        delivery.updated_at,
        delivery.delivery_id,
      );
    if (result.changes !== 1) {
      throw contractError("DELIVERY_WRITE_LOST", "Delivery update was not persisted");
    }
  }

  assertMockDeliveryLease(delivery, providerLeaseToken, nowMs) {
    if (
      delivery.status !== "LEASED" ||
      delivery.provider_lease_token !== providerLeaseToken ||
      !delivery.provider_lease_until ||
      Date.parse(delivery.provider_lease_until) <= nowMs
    ) {
      throw contractError("DELIVERY_CLAIM_LOST", "Delivery lease is missing, expired or stale");
    }
  }

  releaseExpiredMockDeliveryLeases(now, validateDelivery) {
    const nowMs = Date.parse(now);
    const rows = this.db
      .prepare(`
        SELECT delivery_json
        FROM notification_deliveries
        WHERE status = 'LEASED'
      `)
      .all()
      .map((row) => JSON.parse(row.delivery_json));
    for (const current of rows) {
      if (Date.parse(current.provider_lease_until) > nowMs) continue;
      const delivery = {
        ...current,
        status: "RETRY_WAIT",
        row_version: current.row_version + 1,
        updated_at: now,
        error: {
          class: "TRANSIENT",
          code: "MOCK_LEASE_EXPIRED",
          retryable: true,
        },
        next_attempt_at: new Date(
          nowMs + deterministicBackoffSeconds(current.delivery_id, current.attempt_count + 1) * 1000,
        ).toISOString(),
      };
      delete delivery.provider_lease_token;
      delete delivery.provider_lease_until;
      validateDelivery(delivery);
      this.writeDelivery(delivery);
    }
  }

  assertActiveLease(eventId, leaseToken, workerId, workflowKey) {
    const row = this.db
      .prepare("SELECT * FROM events WHERE event_id = ?")
      .get(eventId);
    if (
      !row ||
      row.status !== "LEASED" ||
      row.lease_token !== leaseToken ||
      !row.lease_until ||
      Date.parse(row.lease_until) <= this.now() ||
      (workerId !== undefined && row.worker_id !== workerId) ||
      (workflowKey !== undefined && row.workflow_key !== workflowKey)
    ) {
      throw contractError("CLAIM_LOST", "Lease is missing, expired or belongs to another worker");
    }
    return row;
  }

  markSkipped(eventId, leaseToken, reasonCode) {
    const now = this.isoNow();
    this.db
      .prepare(`
        UPDATE events
        SET status = 'SKIPPED', lease_token = NULL, lease_until = NULL,
            lease_max_until = NULL, worker_id = NULL, last_error_code = ?, updated_at = ?
        WHERE event_id = ? AND lease_token = ? AND status = 'LEASED'
      `)
      .run(reasonCode, now, eventId, leaseToken);
  }

  releaseExpiredLeases(now) {
    const expired = this.db
      .prepare(`
        SELECT * FROM events
        WHERE status = 'LEASED' AND lease_until <= ?
      `)
      .all(now);
    for (const row of expired) {
      if (row.attempt >= row.max_attempts) {
        this.deadLetter(row, "LEASE_EXPIRED_MAX_ATTEMPTS");
      } else {
        const nextAttempt = new Date(
          Date.parse(now) + deterministicBackoffSeconds(row.event_id, row.attempt) * 1000,
        ).toISOString();
        this.db
          .prepare(`
            UPDATE events
            SET status = 'PENDING', lease_token = NULL, lease_until = NULL,
                lease_max_until = NULL, worker_id = NULL,
                next_attempt_at = ?, last_error_code = 'LEASE_EXPIRED', updated_at = ?
            WHERE event_id = ?
          `)
          .run(nextAttempt, now, row.event_id);
      }
      this.finishAttempt(row, "LEASE_EXPIRED", "LEASE_EXPIRED");
    }
  }

  skipExpiredEvents(now) {
    this.db
      .prepare(`
        UPDATE events
        SET status = 'SKIPPED', last_error_code = 'EXPIRED', updated_at = ?
        WHERE status = 'PENDING' AND expires_at IS NOT NULL AND expires_at <= ?
      `)
      .run(now, now);
  }

  skipSupersededLatestOnly(workflowKey, now) {
    const rows = this.db
      .prepare(`
        SELECT event_id, event_json
        FROM events
        WHERE workflow_key = ?
          AND status = 'PENDING'
          AND available_at <= ?
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
          AND (expires_at IS NULL OR expires_at > ?)
      `)
      .all(workflowKey, now, now, now);
    const newestBySubject = new Map();
    for (const row of rows) {
      const event = JSON.parse(row.event_json);
      const subjectKey = [
        event.scope.kind,
        event.scope.club_id ?? "PLATFORM",
        event.event_type,
        event.subject.entity_type,
        event.subject.entity_id,
      ].join(":");
      const current = newestBySubject.get(subjectKey);
      if (!current || isNewerEvent(event, current.event)) {
        newestBySubject.set(subjectKey, { row, event });
      }
    }
    const newestIds = new Set([...newestBySubject.values()].map(({ row }) => row.event_id));
    for (const row of rows) {
      if (newestIds.has(row.event_id)) continue;
      this.db
        .prepare(`
          UPDATE events
          SET status = 'SKIPPED', last_error_code = 'SUPERSEDED_LATEST_ONLY', updated_at = ?
          WHERE event_id = ? AND status = 'PENDING'
        `)
        .run(now, row.event_id);
    }
  }

  deadLetter(row, errorCode) {
    const now = this.isoNow();
    this.db
      .prepare(`
        UPDATE events
        SET status = 'DEAD_LETTER', lease_token = NULL, lease_until = NULL,
            lease_max_until = NULL, worker_id = NULL, last_error_code = ?, updated_at = ?
        WHERE event_id = ?
      `)
      .run(errorCode, now, row.event_id);
    this.db
      .prepare(`
        INSERT INTO dead_letters(dead_letter_id, event_id, error_code, failed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET
          error_code = excluded.error_code,
          failed_at = excluded.failed_at
      `)
      .run(randomUUID(), row.event_id, errorCode, now);
  }

  finishAttempt(row, outcome, errorCode) {
    this.db
      .prepare(`
        UPDATE event_attempts
        SET finished_at = ?, outcome = ?, error_code = ?
        WHERE event_id = ? AND lease_token = ? AND finished_at IS NULL
      `)
      .run(this.isoNow(), outcome, errorCode, row.event_id, row.lease_token);
  }

  claimEnvelope(row) {
    return {
      event: JSON.parse(row.event_json),
      lease_token: row.lease_token,
      lease_until: row.lease_until,
      attempt: Number(row.attempt),
      event_version: Number(row.schema_version),
    };
  }

  isoNow() {
    return new Date(this.now()).toISOString();
  }
}

function rotateAfter(values, cursor) {
  if (!cursor || values.length < 2) return [...values];
  const index = values.indexOf(cursor);
  if (index < 0) return [...values];
  return [...values.slice(index + 1), ...values.slice(0, index + 1)];
}

function deterministicBackoffSeconds(eventId, attempt) {
  const base = Math.min(30 * 2 ** Math.max(0, attempt - 1), 3600);
  const jitterPercent = Number.parseInt(sha256(eventId).slice(0, 2), 16) % 21;
  return Math.round(base * (0.9 + jitterPercent / 100));
}

function isNewerEvent(candidate, current) {
  const candidateVersion = candidate.subject.entity_version;
  const currentVersion = current.subject.entity_version;
  if (Number.isInteger(candidateVersion) && Number.isInteger(currentVersion)) {
    if (candidateVersion !== currentVersion) return candidateVersion > currentVersion;
  } else if (Number.isInteger(candidateVersion) !== Number.isInteger(currentVersion)) {
    return Number.isInteger(candidateVersion);
  }
  const candidateTime = Date.parse(candidate.occurred_at) || Date.parse(candidate.available_at);
  const currentTime = Date.parse(current.occurred_at) || Date.parse(current.available_at);
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  return candidate.event_id > current.event_id;
}
