import test from "node:test";
import assert from "node:assert/strict";

import Database from "better-sqlite3";

import {
  MigrationRunner,
  type Migration,
  type MigrationLogEvent,
} from "./migrations.js";

function readUserVersion(db: Database.Database): number {
  const row = db.pragma("user_version") as Array<{ user_version: number }>;
  return row[0]?.user_version ?? 0;
}

function recorder() {
  const events: MigrationLogEvent[] = [];
  return {
    log: (event: MigrationLogEvent) => events.push(event),
    events,
  };
}

test("applies all migrations on a fresh DB", () => {
  const db = new Database(":memory:");
  const m1: Migration = {
    id: 1,
    name: "create-foo",
    up: (d) => d.exec(`CREATE TABLE foo (id INTEGER PRIMARY KEY)`),
  };
  const m2: Migration = {
    id: 2,
    name: "create-bar",
    up: (d) => d.exec(`CREATE TABLE bar (id INTEGER PRIMARY KEY, foo_id INTEGER REFERENCES foo(id))`),
  };

  const rec = recorder();
  const applied = new MigrationRunner([m1, m2], { log: rec.log }).apply(db);

  assert.equal(applied, 2);
  assert.equal(readUserVersion(db), 2);
  assert.deepEqual(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),
    [{ name: "bar" }, { name: "foo" }],
  );
  const events = rec.events.map((e) => e.event);
  assert.deepEqual(events, [
    "migrations.start",
    "migrations.apply",
    "migrations.applied",
    "migrations.apply",
    "migrations.applied",
    "migrations.complete",
  ]);
});

test("idempotent — second apply is a no-op", () => {
  const db = new Database(":memory:");
  const m1: Migration = {
    id: 1,
    name: "create-foo",
    up: (d) => d.exec(`CREATE TABLE foo (id INTEGER PRIMARY KEY)`),
  };

  const runner = new MigrationRunner([m1]);
  assert.equal(runner.apply(db), 1);
  assert.equal(runner.apply(db), 0);
  assert.equal(readUserVersion(db), 1);
});

test("applies only pending migrations when DB is partially up-to-date", () => {
  const db = new Database(":memory:");
  const m1: Migration = {
    id: 1,
    name: "create-foo",
    up: (d) => d.exec(`CREATE TABLE foo (id INTEGER PRIMARY KEY)`),
  };
  const m2: Migration = {
    id: 2,
    name: "create-bar",
    up: (d) => d.exec(`CREATE TABLE bar (id INTEGER PRIMARY KEY)`),
  };

  // Simulate a DB previously at version 1 — and the foo table existing
  db.exec(`CREATE TABLE foo (id INTEGER PRIMARY KEY)`);
  db.pragma("user_version = 1");

  const applied = new MigrationRunner([m1, m2]).apply(db);

  assert.equal(applied, 1);
  assert.equal(readUserVersion(db), 2);
  const barExists =
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bar'").get();
  assert.deepEqual(barExists, { name: "bar" });
});

test("rolls back on failure and leaves user_version untouched", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE foo (id INTEGER PRIMARY KEY)`);

  const broken: Migration = {
    id: 1,
    name: "broken",
    up: (d) => {
      d.exec(`CREATE TABLE bar (id INTEGER PRIMARY KEY)`);
      // Force failure mid-transaction
      d.exec(`THIS_IS_NOT_VALID_SQL`);
    },
  };

  const rec = recorder();
  assert.throws(() => new MigrationRunner([broken], { log: rec.log }).apply(db));

  // user_version did not advance
  assert.equal(readUserVersion(db), 0);
  // bar was not created (transaction rolled back)
  const barExists =
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bar'").get();
  assert.equal(barExists, undefined);
  // failure was logged
  assert.ok(rec.events.some((e) => e.event === "migrations.failed"));
});

test("legacy DB fast-forward: jumps user_version to seed when DB has tables but version=0", () => {
  const db = new Database(":memory:");
  // Simulate legacy state — tables exist but user_version is 0
  db.exec(`CREATE TABLE legacy_table (id INTEGER PRIMARY KEY)`);
  assert.equal(readUserVersion(db), 0);

  const m1: Migration = {
    id: 1,
    name: "below-seed",
    up: () => {
      throw new Error("should not run on legacy DB at seed=2");
    },
  };
  const m2: Migration = {
    id: 2,
    name: "at-seed",
    up: () => {
      throw new Error("should not run on legacy DB at seed=2");
    },
  };
  const m3: Migration = {
    id: 3,
    name: "above-seed",
    up: (d) => d.exec(`CREATE TABLE post_seed (id INTEGER PRIMARY KEY)`),
  };

  const rec = recorder();
  const applied = new MigrationRunner([m1, m2, m3], {
    log: rec.log,
    latestSeedVersion: 2,
  }).apply(db);

  assert.equal(applied, 1);
  assert.equal(readUserVersion(db), 3);
  const postSeedExists =
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='post_seed'").get();
  assert.deepEqual(postSeedExists, { name: "post_seed" });
  assert.ok(rec.events.some((e) => e.event === "migrations.skip_to_seed"));
});

test("fresh DB (no tables) ignores latestSeedVersion and runs all", () => {
  const db = new Database(":memory:");
  // No tables at all → not legacy → runner applies everything from 0
  const m1: Migration = {
    id: 1,
    name: "first",
    up: (d) => d.exec(`CREATE TABLE one (id INTEGER PRIMARY KEY)`),
  };
  const m2: Migration = {
    id: 2,
    name: "second",
    up: (d) => d.exec(`CREATE TABLE two (id INTEGER PRIMARY KEY)`),
  };

  const applied = new MigrationRunner([m1, m2], { latestSeedVersion: 1 }).apply(db);
  assert.equal(applied, 2);
  assert.equal(readUserVersion(db), 2);
});

test("rejects duplicate migration ids", () => {
  assert.throws(
    () =>
      new MigrationRunner([
        { id: 1, name: "a", up: () => {} },
        { id: 1, name: "b", up: () => {} },
      ]),
    /Duplicate migration id 1/,
  );
});

test("rejects non-positive integer ids", () => {
  assert.throws(
    () => new MigrationRunner([{ id: 0, name: "zero", up: () => {} }]),
    /must be a positive integer/,
  );
  assert.throws(
    () => new MigrationRunner([{ id: -1, name: "neg", up: () => {} }]),
    /must be a positive integer/,
  );
  assert.throws(
    () => new MigrationRunner([{ id: 1.5, name: "frac", up: () => {} }]),
    /must be a positive integer/,
  );
});

test("normalizes input order — accepts unsorted migrations", () => {
  const db = new Database(":memory:");
  const m1: Migration = {
    id: 1,
    name: "first",
    up: (d) => d.exec(`CREATE TABLE one (id INTEGER PRIMARY KEY)`),
  };
  const m2: Migration = {
    id: 2,
    name: "second",
    up: (d) =>
      d.exec(
        `CREATE TABLE two (id INTEGER PRIMARY KEY, one_id INTEGER REFERENCES one(id))`,
      ),
  };

  const applied = new MigrationRunner([m2, m1]).apply(db);
  assert.equal(applied, 2);
  assert.equal(readUserVersion(db), 2);
});

test("empty migration list is a no-op", () => {
  const db = new Database(":memory:");
  const applied = new MigrationRunner([]).apply(db);
  assert.equal(applied, 0);
  assert.equal(readUserVersion(db), 0);
});
