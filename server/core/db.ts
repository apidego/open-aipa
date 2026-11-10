import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
export class Store {
  db: DatabaseSync;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Keep the original storage filename so existing installations retain their data.
    this.db = new DatabaseSync(join(dir, 'openaipa.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user')), created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS connections (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, credentials TEXT NOT NULL, PRIMARY KEY(user_id,provider));
      CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, session_token TEXT NOT NULL, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, prompt TEXT NOT NULL, interval_minutes INTEGER NOT NULL, next_run INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE, status TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id,id);
      CREATE INDEX IF NOT EXISTS conversations_owner ON conversations(user_id,created_at);
      INSERT OR IGNORE INTO migrations(version) VALUES(1);`);
    if (!this.get('SELECT version FROM migrations WHERE version=2')) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE jobs (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK(kind IN ('automation','task')), name TEXT NOT NULL,
            description TEXT NOT NULL, input_prompt TEXT NOT NULL, prompt TEXT NOT NULL,
            script TEXT, schedule TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'dashboard',
            allow_ai INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL CHECK(status IN ('draft','active','paused','completed')),
            next_run INTEGER, script_state TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
          );
          CREATE INDEX jobs_due ON jobs(status,next_run);
          CREATE INDEX jobs_owner ON jobs(user_id,kind);
          CREATE TABLE job_runs (
            id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
            status TEXT NOT NULL, result TEXT, notified INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL, finished_at INTEGER
          );
          CREATE INDEX job_runs_job ON job_runs(job_id,created_at);
          CREATE TABLE notifications (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
            run_id TEXT UNIQUE REFERENCES job_runs(id) ON DELETE SET NULL,
            title TEXT NOT NULL, message TEXT NOT NULL, channel TEXT NOT NULL,
            created_at INTEGER NOT NULL, read_at INTEGER
          );
          CREATE INDEX notifications_owner ON notifications(user_id,created_at);
          INSERT INTO jobs(id,user_id,kind,name,description,input_prompt,prompt,schedule,status,next_run,created_at)
            SELECT id,user_id,'task',name,prompt,prompt,prompt,
              json_object('kind','interval','minutes',interval_minutes,'at',NULL,'cron',NULL,'timezone','UTC'),
              CASE enabled WHEN 1 THEN 'active' ELSE 'paused' END,next_run,${Date.now()} FROM automations;
          INSERT INTO job_runs(id,job_id,status,result,created_at)
            SELECT id,automation_id,status,result,created_at FROM runs;
          INSERT INTO migrations(version) VALUES(2);
        `);
      });
    }
  }
  run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params);
  }
  get<T>(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  all<T>(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).all(...params) as T[];
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  setting(key: string) {
    return this.get<{ value: string }>('SELECT value FROM settings WHERE key=?', key)?.value || '';
  }
  set(key: string, value: string) {
    this.run(
      'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      key,
      value,
    );
  }
}
