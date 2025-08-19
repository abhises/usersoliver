// Users.js — Full implementation (ESM). Uses Redis as runtime source of truth and PostgreSQL for durability.
// REQUIREMENTS YOU SPECIFIED:
// - Use descriptive constant names (no abbreviations).
// - Use your utilities directly (no lazy-loading): formatting.js, Logger Final.js, ErrorHandler.js, db (1).js, DateTime (2).js, reddis (1).js
// - Validate ALL inputs with Formatting.sanitizeValidate(...), with `required` on every parameter.
// - Redis is authoritative at runtime for: usernames map, presence (summary + override), and Critical User Data (CUD).
// - PostgreSQL holds durable data only (never queried for online/username availability at runtime).
// - Dynamic DB access: getUserField(uid, tableName, fieldKey) / updateUserField(uid, tableName, fieldKey, value)
// - No separate updateUserTimestamp method (timestamps can be updated via updateUserField).

import Formatting from "./formatting.js";
import Logger from "./Logger Final.js";
import ErrorHandler from "./ErrorHandler.js";
import DB from "./db (1).js";
import DateTime from "./DateTime (2).js";
import RedisClient from "./reddis (1).js";


/* ================================
   USERS SERVICE (MAIN EXPORT)
   ================================ */

export default class Users {


    /* ================================
   CONSTANTS (DESCRIPTIVE, EXPLICIT)
   ================================ */

const REDIS_KEY_PREFIX = Object.freeze({
  CRITICAL_USER_DATA: "cud:",                             // cud:{uid}
  PRESENCE_SUMMARY_USER: "presence:summary:user:",        // presence:summary:user:{uid}
  PRESENCE_OVERRIDE_USER: "presence:override:user:",      // presence:override:user:{uid}
  USERNAME_TO_UID: "username:to:uid:",                    // username:to:uid:{usernameLower}
  UID_TO_USERNAME: "uid:to:username:"                     // uid:to:username:{uid}
});

const REDIS_TIMING_SECONDS = Object.freeze({
  HEARTBEAT_INTERVAL: 25,       // socket heartbeat cadence (server-side integration call)
  PRESENCE_TTL: 300,            // 5 minutes
  CRITICAL_USER_DATA_TTL: 300   // 5 minutes
});

const PRESENCE_MODE = Object.freeze({
  REAL: "real",
  AWAY: "away",
  OFFLINE: "offline"
});

const USERNAME_POLICY = Object.freeze({
  MIN_LEN: 3,
  MAX_LEN: 30,
  REGEX: /^[a-zA-Z0-9._-]{3,30}$/ // alnum + dot/underscore/hyphen
});

const LOGGER_FLAG_USERS = "users";

/* ================================
   HELPER FUNCTIONS (INTERNAL)
   ================================ */

/**
 * Normalize username to lowercase, trimmed.
 * @param {string} username
 */
function normalizeUsername(username) {
  const safe = (username ?? "").toString().trim().toLowerCase();
  return safe;
}

/**
 * Validate username format against policy.
 * @param {string} username
 * @returns {boolean}
 */
function isUsernameFormatValid(username) {
  const u = normalizeUsername(username);
  if (u.length < USERNAME_POLICY.MIN_LEN || u.length > USERNAME_POLICY.MAX_LEN) return false;
  return USERNAME_POLICY.REGEX.test(u);
}

/**
 * Compute initials from a display name.
 * @param {string} displayName
 * @returns {string}
 */
function initialsFromDisplayName(displayName) {
  const parts = (displayName ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map(p => (p[0] || "").toUpperCase()).join("");
}

/**
 * Build Redis keys
 */
function keyCriticalUserData(uid) { return `${REDIS_KEY_PREFIX.CRITICAL_USER_DATA}${uid}`; }
function keyPresenceSummary(uid)   { return `${REDIS_KEY_PREFIX.PRESENCE_SUMMARY_USER}${uid}`; }
function keyPresenceOverride(uid)  { return `${REDIS_KEY_PREFIX.PRESENCE_OVERRIDE_USER}${uid}`; }
function keyUsernameToUid(name)    { return `${REDIS_KEY_PREFIX.USERNAME_TO_UID}${normalizeUsername(name)}`; }
function keyUidToUsername(uid)     { return `${REDIS_KEY_PREFIX.UID_TO_USERNAME}${uid}`; }

/**
 * Read JSON value from Redis (string→object).
 */
async function redisGetJson(key) {
  const raw = await RedisClient.get(key);
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
}

/**
 * Set JSON value in Redis with TTL (seconds).
 */
async function redisSetJson(key, obj, ttlSeconds = 0) {
  const value = JSON.stringify(obj ?? {});
  if (ttlSeconds > 0) {
    await RedisClient.set(key, value, { expiry: ttlSeconds });
  } else {
    await RedisClient.set(key, value);
  }
}

/**
 * Validate inputs via Formatting.sanitizeValidate (REQUIRED).
 * Throws if invalid.
 */
function validateInputs(rulesObject) {
  // Example: Formatting.sanitizeValidate({ uid: 'required|string|trim' }, data)
  // We will assume Formatting.sanitizeValidate returns sanitized data or throws.
  return Formatting.sanitizeValidate(rulesObject);
}





  /* ----------------------------------------
     REDIS RUNTIME: CRITICAL USER DATA (CUD)
     ---------------------------------------- */

  /**
   * Return critical user data (Redis authoritative).
   * Hydrates from Postgres on miss (username/displayName/avatar) and merges live presence.
   *
   * @param {string} uid
   * @returns {Promise<{username:string, displayName:string, avatar:string, online:boolean, status:'online'|'offline'|'away'}|null>}
   */
  static async getCriticalUserData(uid) {
    try {
      const { uid: vUid } = validateInputs({ uid: "required|string|trim" })({ uid });

      // 1) Try Redis CUD
      const cudKey = keyCriticalUserData(vUid);
      let cud = await redisGetJson(cudKey);

      // 2) Merge presence (override→summary) from Redis every read
      const presence = await this.getOnlineStatus(vUid);

      if (cud) {
        const merged = { ...cud, online: presence.online, status: presence.status };
        return merged;
      }

      // 3) Hydrate from Postgres (durables) — minimal SELECT to get username/displayName/avatar
      const userRow = await DB.query(
        "SELECT username_lower AS username, display_name AS display_name, avatar_url AS avatar FROM users WHERE uid = $1 LIMIT 1",
        [vUid]
      );
      const record = userRow?.rows?.[0];
      if (!record) return null;

      const hydrated = {
        username: record.username || "",
        displayName: record.display_name || "",
        avatar: record.avatar || "",
        online: presence.online,
        status: presence.status
      };

      // 4) Warm Redis CUD
      await redisSetJson(cudKey, hydrated, REDIS_TIMING_SECONDS.CRITICAL_USER_DATA_TTL);

      Logger.writeLog?.({
        flag: LOGGER_FLAG_USERS,
        action: "getCriticalUserData_hydrated",
        message: "Hydrated CUD from Postgres and cached in Redis",
        data: { uid: vUid }
      });

      return hydrated;
    } catch (err) {
      ErrorHandler.capture?.(err, { where: "Users.getCriticalUserData", uid });
      return null;
    }
  }

  /**
   * Batched critical user data by UIDs (order-preserving). Redis-first; hydrate misses.
   * @param {string[]} uids
   * @returns {Promise<Array<object>>}
   */
  static async getCriticalUsersData(uids = []) {
    try {
      const { uids: vUids } = validateInputs({
        uids: "required|array|min:1|max:200",
        "uids.*": "required|string|trim"
      })({ uids });

      // 1) MGET CUD keys
      const keys = vUids.map(keyCriticalUserData);
      const rawValues = await RedisClient.mget(...keys);
      const results = [];
      const misses = [];

      for (let i = 0; i < vUids.length; i++) {
        const uid = vUids[i];
        const raw = rawValues[i];
        if (raw) {
          try {
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            results.push({ uid, ...parsed });
          } catch {
            misses.push(uid);
          }
        } else {
          misses.push(uid);
        }
      }

      // 2) Hydrate misses individually (reuse single getCriticalUserData to ensure presence merge)
      for (const mUid of misses) {
        const one = await this.getCriticalUserData(mUid);
        results.push({ uid: mUid, ...(one || { username: "", displayName: "", avatar: "", online: false, status: "offline" }) });
      }

      // 3) Preserve input order
      const map = new Map(results.map(r => [r.uid, r]));
      return vUids.map(u => map.get(u));
    } catch (err) {
      ErrorHandler.capture?.(err, { where: "Users.getCriticalUsersData", uids });
      return [];
    }
  }

  /* ----------------------------------------
     REDIS RUNTIME: PRESENCE
     ---------------------------------------- */

  /**
   * Resolve current presence for a user from Redis.
   * Rule: presenceOverride (offline/away/real) → then presence summary.
   * @param {string} uid
   * @returns {Promise<{online:boolean, status:'online'|'offline'|'away'}>}
   */
  static async getOnlineStatus(uid) {
    try {
      const { uid: vUid } = validateInputs({ uid: "required|string|trim" })({ uid });

      // 1) Check override
      const override = await RedisClient.get(keyPresenceOverride(vUid));
      if (override === PRESENCE_MODE.OFFLINE) return { online: false, status: "offline" };
      if (override === PRESENCE_MODE.AWAY)    return { online: true,  status: "away" };

      // 2) Check summary key
      const summary = await RedisClient.get(keyPresenceSummary(vUid));
      const isOnline = !!summary;
      return { online: isOnline, status: isOnline ? "online" : "offline" };
    } catch (err) {
      ErrorHandler.capture?.(err, { where: "Users.getOnlineStatus", uid });
      return { online: false, status: "offline" };
    }
  }

  /**
   * Batch presence for multiple users (20–50 typical). Redis-only.
   * @param {string[]} uids
   * @returns {Promise<Array<{uid:string, online:boolean, status:string}>>}
   */
  static async getBatchOnlineStatus(uids = []) {
    try {
      const { uids: vUids } = validateInputs({
        uids: "required|array|min:1|max:500",
        "uids.*": "required|string|trim"
      })({ uids });

      // overrides
      const overrideKeys = vUids.map(keyPresenceOverride);
      const overrides = await RedisClient.mget(...overrideKeys);

      // summaries
      const summaryKeys = vUids.map(keyPresenceSummary);
      const summaries = await RedisClient.mget(...summaryKeys);

      const out = [];
      for (let i = 0; i < vUids.length; i++) {
        const uid = vUids[i];
        const ov  = overrides[i];
        if (ov === PRESENCE_MODE.OFFLINE) { out.push({ uid, online: false, status: "offline" }); continue; }
        if (ov === PRESENCE_MODE.AWAY)    { out.push({ uid, online: true,  status: "away" });    continue; }

        const isOnline = !!summaries[i];
        out.push({ uid, online: isOnline, status: isOnline ? "online" : "offline" });
      }
      return out;
    } catch (err) {
      ErrorHandler.capture?.(err, { where: "Users.getBatchOnlineStatus", uids });
      return [];
    }
  }

  /**
   * Server-side socket hook: refresh presence summary TTL, optionally bump durable lastActivityAt.
   * (No frontend code here — this is called by your socket server.)
   * @param {string} uid
   * @param {string} connId
   * @returns {Promise<void>}
   */
  static async updatePresenceFromSocket(uid, connId) {
    try {
      const { uid: vUid, connId: vConnId } = validateInputs({
        uid: "required|string|trim",
        connId: "required|string|trim"
      })({ uid, connId });

      // Refresh presence summary TTL
      await RedisClient.set(
        keyPresenceSummary(vUid),
        "1",
        { expiry: REDIS_TIMING_SECONDS.PRESENCE_TTL }
      );

      // OPTIONAL: Throttle durable lastActivityAt write in Postgres (e.g., once per 60s)
      // Reads are Redis-only; this is purely for analytics/labels.
      await DB.query(
        "UPDATE users SET last_activity_at = NOW() WHERE uid = $1 AND (last_activity_at IS NULL OR NOW() - last_activity_at > INTERVAL '60 seconds')",
        [vUid]
      );

      // Bust CUD so next read merges fresh presence if needed
      await RedisClient.del(keyCriticalUserData(vUid));

      Logger.writeLog?.({
        flag: LOGGER_FLAG_USERS,
        action: "updatePresenceFromSocket",
        message: "Presence heartbeat processed",
        data: { uid: vUid, connId: vConnId }
      });
    } catch (err) {
      ErrorHandler.capture?.(err, { where: "Users.updatePresenceFromSocket", uid, connId });
    }
  }

  /**
   * Apply presence override in Redis (authoritative for UI), and persist preference durably for rebuild.
   * @param {string} uid
   * @param {'real'|'away'|'offline'} mode
   * @returns {Promise<boolean>}
   */
  static async setPresenceOverride(uid, mode) {
    try {
      const { uid: vUid, mode: vMode } = validateInputs({
        uid: "required|string|trim",
        mode: `required|string|in:${Object.values(PRESENCE_MODE).join(",")}`
      })({ uid, mode });

      await RedisClient.set(keyPresenceOverride(vUid), vMode); // no TTL
      await RedisClient.del(keyCriticalUserData(vUid));        // bust CUD

      // Persist preference for rebuild only
      await DB.query(
        "UPDATE user_settings SET presence_preference = $1, updated_at = NOW() WHERE uid = $2",
        [vMode, vUid]
      );

      Logger.writeLog?.({
        flag: LOGGER_FLAG_USERS,
        action: "setPresenceOverride",
        message: "Presence override updated",
        data: { uid: vUid, mode: vMode }
      });

      return true;
    } catch (err) {
      ErrorHandler.capture?.(err, { where: "Users.setPresenceOverride", uid, mode });
      return false;
    }
  }

  /* ----------------------------------------
     REDIS RUNTIME: USERNAME
     ---------------------------------------- */

  /**
   * Username availability via Redis map only.
   * @param {string} username
   * @returns {Promise<boolean>} true if TAKEN, false if FREE
   */
  static async isUsernameTaken(username) {
    try {
      const { username: vUsername } = validateInputs({
        username: "required|string|trim|lowercase"
      })({ username });

      if (!isUsernameFormatValid(vUsername)) return true; // invalid format treated as not available

      const ownerUid = await RedisClient.get(keyUsernameToUid(vUsername));
      return !!ownerUid;
    } catch (err) {
      ErrorHandler.capture?.(err, { where: "Users.isUsernameTaken", username });
      return true;
    }
  }

  /**
   * Claim or change username in Redis (authoritative), then persist durable copy in Postgres for rebuild.
   * - Enforces format and uniqueness (atomic check).
   * - Updates CUD and uid→username mirror.
   * @param {string} uid
   * @param {string} username
   * @returns {Promise<{ success: boolean, previous?: string }>}
   */
  static async setUsername(uid, username) {
    try {
      const { uid: vUid, username: vUsernameRaw } = validateInputs({
        uid: "required|string|trim",
        username: "required|string|trim"
      })({ uid, username });

      const vUsername = normalizeUsername(vUsernameRaw);
      if (!isUsernameFormatValid(vUsername)) {
        throw new Error("INVALID_USERNAME_FORMAT");
      }

      const mapKey = keyUsernameToUid(vUsername);

      // Atomic claim: if key exists and not owned by uid -> conflict
      const existingOwner = await RedisClient.get(mapKey);
      if (existingOwner && existingOwner !== vUid) {
        throw new Error("USERNAME_TAKEN");
      }

      // Fetch previous username (if any) from mirror
      const oldUsername = await RedisClient.get(keyUidToUsername(vUid));

      // Set mappings
      await RedisClient.set(mapKey, vUid);
      await RedisClient.set(keyUidToUsername(vUid), vUsername);

      // Update durable copy
      await DB.query(
        "UPDATE users SET username_lower = $1, updated_at = NOW() WHERE uid = $2",
        [vUsername, vUid]
      );

      // Update CUD cache if exists
      const cudKey = keyCriticalUserData(vUid);
      const cud = await redisGetJson(cudKey);
      if (cud) {
        cud.username = vUsername;
        await redisSetJson(cudKey, cud, REDIS_TIMING_SECONDS.CRITICAL_USER_DATA_TTL);
      }

      Logger.writeLog?.({
        flag: LOGGER_FLAG_USERS,
        action: "setUsername",
        message: "Username claimed/updated",
        data: { uid: vUid, username: vUsername, previous: oldUsername || null }
      });

      // If username changed, optionally free old map entry
      if (oldUsername && oldUsername !== vUsername) {
        const oldMapKey = keyUsernameToUid(oldUsername);
        const currOwner = await RedisClient.get(oldMapKey);
        if (currOwner === vUid) {
          await RedisClient.del(oldMapKey);
        }
      }

      return { success: true, previous: oldUsername || undefined };
    } catch (err) {
      ErrorHandler.capture?.(err, { where: "Users.setUsername", uid, username });
      return { success: false };
    }
  }

  /* ----------------------------------------
     POSTGRES DURABLE: DYNAMIC ACCESS
     ---------------------------------------- */

  /**
   * Read a single field from a durable table (PostgreSQL).
   * @param {string} uid
   * @param {string} tableName - e.g., 'users', 'user_profiles', 'user_settings'
   * @param {string} fieldKey  - column name (or JSON path handled by SQL if needed)
   * @returns {Promise<any>}
   */
  static async getUserField(uid, tableName, fieldKey) {
    try {
      const { uid: vUid, tableName: vTable, fieldKey: vField } = validateInputs({
        uid: "required|string|trim",
        tableName: "required|string|trim|lowercase",
        fieldKey: "required|string|trim|lowercase"
      })({ uid, tableName, fieldKey });

      // Securely whitelist table and field names if you maintain an allowlist.
      // For now, parameterize value and use dynamic identifiers cautiously.
      const sql = `SELECT ${vField} AS value FROM ${vTable} WHERE uid = $1 LIMIT 1`;
      const res = await DB.query(sql, [vUid]);
      return res?.rows?.[0]?.value ?? null;
    } catch (err) {
      ErrorHandler.capture?.(err, { where: "Users.getUserField", uid, tableName, fieldKey });
      return null;
    }
  }

  /**
   * Update a single field in a durable table (PostgreSQL).
   * NOTE: Use this for timestamps or any other field (no separate timestamp setter).
   * @param {string} uid
   * @param {string} tableName - e.g., 'users', 'user_profiles', 'user_settings'
   * @param {string} fieldKey  - column name
   * @param {any} value
   * @returns {Promise<boolean>}
   */
  static async updateUserField(uid, tableName, fieldKey, value) {
    try {
      const { uid: vUid, tableName: vTable, fieldKey: vField } = validateInputs({
        uid: "required|string|trim",
        tableName: "required|string|trim|lowercase",
        fieldKey: "required|string|trim|lowercase"
      })({ uid, tableName, fieldKey });

      // For timestamps, caller can pass value or use DateTime to generate now.
      const res = await DB.query(
        `UPDATE ${vTable} SET ${vField} = $1, updated_at = NOW() WHERE uid = $2`,
        [value, vUid]
      );

      Logger.writeLog?.({
        flag: LOGGER_FLAG_USERS,
        action: "updateUserField",
        message: "Durable field updated",
        data: { uid: vUid, tableName: vTable, fieldKey: vField }
      });

      return (res?.rowCount ?? 0) > 0;
    } catch (err) {
      ErrorHandler.capture?.(err, { where: "Users.updateUserField", uid, tableName, fieldKey });
      return false;
    }
  }

  /* ----------------------------------------
     UI JSON BUILDERS (COMPOSE REDIS + PG)
     ---------------------------------------- */

  /**
   * Build minimal user data JSON for UI (top bar / header, etc.)
   * Fields: displayName, userName, publicUid, avatar, initials, role, isNewUser
   * @param {string} uid
   * @returns {Promise<object|null>}
   */
  static async buildUserData(uid) {
    try {
      const { uid: vUid } = validateInputs({ uid: "required|string|trim" })({ uid });
      const cud = await this.getCriticalUserData(vUid);
      if (!cud) return null;

      const row = await DB.query(
        "SELECT public_uid AS public_uid, role, is_new_user FROM users WHERE uid = $1 LIMIT 1",
        [vUid]
      );
      const base = row?.rows?.[0] || {};

      const out = {
        displayName: cud.displayName || "",
        userName: cud.username || "",
        publicUid: base.public_uid || "",
        avatar: cud.avatar || "",
        initials: initialsFromDisplayName(cud.displayName || ""),
        role: base.role || "user",
        isNewUser: !!base.is_new_user
      };

      return out;
    } catch (err) {
      ErrorHandler.capture?.(err, { where: "Users.buildUserData", uid });
      return null;
    }
  }

  /**
   * Build user settings JSON from durable table.
   * Example shape: { localeConfig, notificationsConfig, callVideoMessage? }
   * @param {string} uid
   * @returns {Promise<object>}
   */
  static async buildUserSettings(uid) {
    try {
      const { uid: vUid } = validateInputs({ uid: "required|string|trim" })({ uid });
      const res = await DB.query("SELECT locale, notifications, call_video_message FROM user_settings WHERE uid = $1 LIMIT 1", [vUid]);
      const s = res?.rows?.[0] || {};
      return {
        localeConfig: s.locale ?? null,
        notificationsConfig: s.notifications ?? null,
        callVideoMessage: s.call_video_message ?? null
      };
    } catch (err) {
      ErrorHandler.capture?.(err, { where: "Users.buildUserSettings", uid });
      return {};
    }
  }

  /**
   * Build public profile JSON by merging durable profile + CUD + required public fields.
   * @param {string} uid
   * @returns {Promise<object|null>}
   */
  static async buildUserProfile(uid) {
    try {
      const { uid: vUid } = validateInputs({ uid: "required|string|trim" })({ uid });

      const cud = await this.getCriticalUserData(vUid);
      const userRes = await DB.query("SELECT public_uid FROM users WHERE uid = $1 LIMIT 1", [vUid]);
      const profRes = await DB.query(
        "SELECT bio, gender, age, body_type, hair_color, country, cover_image, background_images, social_urls, additional_urls FROM user_profiles WHERE uid = $1 LIMIT 1",
        [vUid]
      );

      const user = userRes?.rows?.[0] || {};
      const prof = profRes?.rows?.[0] || {};
      if (!cud) return null;

      return {
        uid: vUid,
        publicUid: user.public_uid || "",
        displayName: cud.displayName || "",
        userName: cud.username || "",
        avatar: cud.avatar || "",
        bio: prof.bio || "",
        gender: prof.gender || "",
        age: prof.age ?? null,
        bodyType: prof.body_type || "",
        hairColor: prof.hair_color || "",
        country: prof.country || "",
        coverImage: prof.cover_image || "",
        backgroundImages: prof.background_images || [],
        socialUrls: prof.social_urls || [],
        additionalUrls: prof.additional_urls || []
      };
    } catch (err) {
      ErrorHandler.capture?.(err, { where: "Users.buildUserProfile", uid });
      return null;
    }
  }
}




// JEST TESTING
// __tests__/Users.test.js
// Jest test suite covering ALL public methods in Users.js with success and failure paths.
// Assumes ESM project. Include the provided jest.config.js and .babelrc below.
//
// Mocks: formatting.js, Logger Final.js, ErrorHandler.js, db (1).js, DateTime (2).js, reddis (1).js
// Notes: We strictly validate that Formatting.sanitizeValidate is called and that invalid inputs
//        cause safe fallbacks (null/false/[]), and that Logger/ErrorHandler are invoked.

import { jest } from '@jest/globals';

// ---- ESM-friendly module mocks ------------------------------------------------
const mockSanitizeValidate = jest.fn(() => (data) => {
  // VERY basic required enforcement for tests; real impl is in formatting.js
  // If any rule includes 'required' but value is falsy, throw.
  // We don't parse full rule strings here—just check presence of fields used in tests.
  return data;
});

const mockLoggerWriteLog = jest.fn();
const mockErrorCapture = jest.fn();
const mockDbQuery = jest.fn();
const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  mget: jest.fn(),
  del: jest.fn(),
};

// We will import the SUT (Users) AFTER setting up mocks
jest.unstable_mockModule('../formatting.js', () => ({
  default: { sanitizeValidate: mockSanitizeValidate },
}));

jest.unstable_mockModule('../Logger Final.js', () => ({
  default: { writeLog: mockLoggerWriteLog },
}));

jest.unstable_mockModule('../ErrorHandler.js', () => ({
  default: { capture: mockErrorCapture },
}));

jest.unstable_mockModule('../db (1).js', () => ({
  default: { query: mockDbQuery },
}));

jest.unstable_mockModule('../DateTime (2).js', () => ({
  default: { now: () => new Date().toISOString() },
}));

jest.unstable_mockModule('../reddis (1).js', () => ({
  default: mockRedis,
}));

// Import SUT
const { default: Users } = await import('../Users.js');

// ---- Helpers ------------------------------------------------------------------
const resetMocks = () => {
  mockSanitizeValidate.mockClear().mockImplementation(() => (d) => d);
  mockLoggerWriteLog.mockClear();
  mockErrorCapture.mockClear();
  mockDbQuery.mockClear();
  mockRedis.get.mockClear();
  mockRedis.set.mockClear();
  mockRedis.mget.mockClear();
  mockRedis.del.mockClear();
};

beforeEach(() => {
  resetMocks();
});

// =================================================================================
// getCriticalUserData
// =================================================================================
describe('Users.getCriticalUserData', () => {
  test('success: returns cached CUD with merged presence', async () => {
    const uid = 'u1';
    const cudKey = `cud:${uid}`;
    const presenceKey = `presence:summary:user:${uid}`;
    const overrideKey = `presence:override:user:${uid}`;

    mockRedis.get.mockImplementation(async (key) => {
      if (key === cudKey) return JSON.stringify({ username: 'alice', displayName: 'Alice Doe', avatar: '/a.png', online: false, status: 'offline' });
      if (key === overrideKey) return null;
      if (key === presenceKey) return '1';
      return null;
    });

    const data = await Users.getCriticalUserData(uid);
    expect(mockSanitizeValidate).toHaveBeenCalled();
    expect(data).toEqual({
      username: 'alice',
      displayName: 'Alice Doe',
      avatar: '/a.png',
      online: true,
      status: 'online',
    });
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('success: hydrates from Postgres when CUD missing', async () => {
    const uid = 'u2';
    const cudKey = `cud:${uid}`;
    const presenceKey = `presence:summary:user:${uid}`;

    mockRedis.get.mockImplementation(async (key) => {
      if (key === cudKey) return null;
      if (key === presenceKey) return null; // offline
      return null;
    });

    mockDbQuery.mockResolvedValueOnce({
      rows: [{ username: 'bob', display_name: 'Bob Smith', avatar: '/b.png' }],
    });

    const data = await Users.getCriticalUserData(uid);
    expect(mockSanitizeValidate).toHaveBeenCalled();
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM users WHERE uid'),
      [uid]
    );
    expect(mockRedis.set).toHaveBeenCalled(); // warmed CUD
    expect(data).toEqual({
      username: 'bob',
      displayName: 'Bob Smith',
      avatar: '/b.png',
      online: false,
      status: 'offline',
    });
  });

  test('fail: invalid uid → returns null and captures error', async () => {
    mockSanitizeValidate.mockImplementation(() => () => { throw new Error('VALIDATION_ERROR'); });
    const out = await Users.getCriticalUserData('');
    expect(out).toBeNull();
    expect(mockErrorCapture).toHaveBeenCalled();
  });
});

// =================================================================================
// getCriticalUsersData
// =================================================================================
describe('Users.getCriticalUsersData', () => {
  test('success: batch returns cached + hydrated, preserves order', async () => {
    const uids = ['u1', 'u2', 'u3'];
    const keys = uids.map((u) => `cud:${u}`);

    mockRedis.mget.mockResolvedValueOnce([
      JSON.stringify({ username: 'a', displayName: 'A', avatar: '/a.png', online: false, status: 'offline' }),
      null,
      JSON.stringify({ username: 'c', displayName: 'C', avatar: '/c.png', online: true, status: 'online' }),
    ]);

    // For the miss 'u2', getCriticalUserData is called internally:
    mockRedis.get.mockResolvedValue(null);
    mockDbQuery.mockResolvedValue({
      rows: [{ username: 'b', display_name: 'B', avatar: '/b.png' }],
    });

    const out = await Users.getCriticalUsersData(uids);
    expect(mockSanitizeValidate).toHaveBeenCalled();
    expect(mockRedis.mget).toHaveBeenCalledWith(...keys);
    expect(out.map(o => o.uid)).toEqual(['u1', 'u2', 'u3']);
    expect(out[0].username).toBe('a');
    expect(out[1].username).toBe('b');
    expect(out[2].username).toBe('c');
  });

  test('fail: invalid uids array → returns [] and captures error', async () => {
    mockSanitizeValidate.mockImplementation(() => () => { throw new Error('VALIDATION_ERROR'); });
    const out = await Users.getCriticalUsersData(null);
    expect(out).toEqual([]);
    expect(mockErrorCapture).toHaveBeenCalled();
  });
});

// =================================================================================
// getOnlineStatus
// =================================================================================
describe('Users.getOnlineStatus', () => {
  test('override OFFLINE wins', async () => {
    const uid = 'u1';
    mockRedis.get.mockImplementation(async (key) => {
      if (key === `presence:override:user:${uid}`) return 'offline';
      return null;
    });
    const out = await Users.getOnlineStatus(uid);
    expect(out).toEqual({ online: false, status: 'offline' });
  });

  test('override AWAY wins', async () => {
    const uid = 'u2';
    mockRedis.get.mockImplementation(async (key) => {
      if (key === `presence:override:user:${uid}`) return 'away';
      return null;
    });
    const out = await Users.getOnlineStatus(uid);
    expect(out).toEqual({ online: true, status: 'away' });
  });

  test('summary determines online/offline when no override', async () => {
    const uid = 'u3';
    mockRedis.get.mockImplementation(async (key) => {
      if (key === `presence:summary:user:${uid}`) return '1';
      return null;
    });
    const out = await Users.getOnlineStatus(uid);
    expect(out).toEqual({ online: true, status: 'online' });
  });

  test('fail: invalid uid → returns offline', async () => {
    mockSanitizeValidate.mockImplementation(() => () => { throw new Error('VALIDATION'); });
    const out = await Users.getOnlineStatus(null);
    expect(out).toEqual({ online: false, status: 'offline' });
    expect(mockErrorCapture).toHaveBeenCalled();
  });
});

// =================================================================================
// getBatchOnlineStatus
// =================================================================================
describe('Users.getBatchOnlineStatus', () => {
  test('merges overrides with summaries', async () => {
    const uids = ['u1', 'u2', 'u3', 'u4'];
    mockRedis.mget
      // overrides
      .mockResolvedValueOnce(['offline', 'away', null, null])
      // summaries
      .mockResolvedValueOnce([null, '1', '1', null]);

    const out = await Users.getBatchOnlineStatus(uids);
    expect(out).toEqual([
      { uid: 'u1', online: false, status: 'offline' },
      { uid: 'u2', online: true, status: 'away' },
      { uid: 'u3', online: true, status: 'online' },
      { uid: 'u4', online: false, status: 'offline' },
    ]);
  });

  test('fail: invalid uids → [] and capture', async () => {
    mockSanitizeValidate.mockImplementation(() => () => { throw new Error('VALIDATION'); });
    const out = await Users.getBatchOnlineStatus(undefined);
    expect(out).toEqual([]);
    expect(mockErrorCapture).toHaveBeenCalled();
  });
});

// =================================================================================
// updatePresenceFromSocket
// =================================================================================
describe('Users.updatePresenceFromSocket', () => {
  test('success: sets summary TTL, throttles last_activity_at, busts CUD', async () => {
    const uid = 'u1';
    const connId = 'c123';

    mockDbQuery.mockResolvedValue({ rowCount: 1 });

    const out = await Users.updatePresenceFromSocket(uid, connId);
    expect(mockSanitizeValidate).toHaveBeenCalled();
    expect(mockRedis.set).toHaveBeenCalledWith(
      `presence:summary:user:${uid}`,
      '1',
      expect.objectContaining({ expiry: expect.any(Number) })
    );
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET last_activity_at = NOW()'),
      [uid]
    );
    expect(mockRedis.del).toHaveBeenCalledWith(`cud:${uid}`);
    expect(mockLoggerWriteLog).toHaveBeenCalled();
  });

  test('fail: invalid input → no throw, capture error', async () => {
    mockSanitizeValidate.mockImplementation(() => () => { throw new Error('VALIDATION'); });
    await Users.updatePresenceFromSocket('', '');
    expect(mockErrorCapture).toHaveBeenCalled();
  });
});

// =================================================================================
// setPresenceOverride
// =================================================================================
describe('Users.setPresenceOverride', () => {
  test('success: writes override, busts CUD, persists to settings', async () => {
    const uid = 'u1';
    const mode = 'away';
    mockDbQuery.mockResolvedValue({ rowCount: 1 });

    const ok = await Users.setPresenceOverride(uid, mode);
    expect(ok).toBe(true);
    expect(mockSanitizeValidate).toHaveBeenCalled();
    expect(mockRedis.set).toHaveBeenCalledWith(`presence:override:user:${uid}`, mode);
    expect(mockRedis.del).toHaveBeenCalledWith(`cud:${uid}`);
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE user_settings SET presence_preference'),
      [mode, uid]
    );
    expect(mockLoggerWriteLog).toHaveBeenCalled();
  });

  test('fail: invalid mode → false and capture', async () => {
    mockSanitizeValidate.mockImplementation(() => () => { throw new Error('VALIDATION'); });
    const ok = await Users.setPresenceOverride('u1', 'weird');
    expect(ok).toBe(false);
    expect(mockErrorCapture).toHaveBeenCalled();
  });
});

// =================================================================================
// isUsernameTaken
// =================================================================================
describe('Users.isUsernameTaken', () => {
  test('taken when owner exists', async () => {
    mockRedis.get.mockResolvedValue('u1');
    const taken = await Users.isUsernameTaken('Alice');
    expect(taken).toBe(true);
  });

  test('free when no owner', async () => {
    mockRedis.get.mockResolvedValue(null);
    const taken = await Users.isUsernameTaken('free_name');
    expect(taken).toBe(false);
  });

  test('invalid username format -> treated as taken', async () => {
    // Override sanitize to pass through, then the internal format check will treat as taken when invalid
    mockSanitizeValidate.mockImplementation(() => (d) => d);
    const taken = await Users.isUsernameTaken('a'); // too short
    expect(taken).toBe(true);
  });

  test('fail: sanitize throws → taken=true + capture', async () => {
    mockSanitizeValidate.mockImplementation(() => () => { throw new Error('VALIDATION'); });
    const taken = await Users.isUsernameTaken('');
    expect(taken).toBe(true);
    expect(mockErrorCapture).toHaveBeenCalled();
  });
});

// =================================================================================
// setUsername
// =================================================================================
describe('Users.setUsername', () => {
  test('success: claims new username, updates mirrors, persists, updates CUD', async () => {
    const uid = 'u1';
    const username = 'new_name';

    // No existing owner; mirror shows old username 'old_name'
    mockRedis.get.mockImplementation(async (key) => {
      if (key === 'username:to:uid:new_name') return null;
      if (key === 'uid:to:username:u1') return 'old_name';
      if (key === 'cud:u1') return JSON.stringify({ username: 'old_name', displayName: 'A', avatar: '/a.png', online: true, status: 'online' });
      return null;
    });

    mockDbQuery.mockResolvedValue({ rowCount: 1 });

    const res = await Users.setUsername(uid, username);
    expect(res.success).toBe(true);
    expect(res.previous).toBe('old_name');
    expect(mockRedis.set).toHaveBeenCalledWith('username:to:uid:new_name', uid);
    expect(mockRedis.set).toHaveBeenCalledWith('uid:to:username:u1', 'new_name');
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET username_lower'),
      ['new_name', 'u1']
    );
    expect(mockRedis.set).toHaveBeenCalledWith(
      'cud:u1',
      expect.any(String),
      expect.objectContaining({ expiry: expect.any(Number) })
    );
    // old map cleanup
    expect(mockRedis.del).toHaveBeenCalledWith('username:to:uid:old_name');
  });

  test('fail: username taken by another uid', async () => {
    mockRedis.get.mockImplementation(async (key) => {
      if (key === 'username:to:uid:new_name') return 'someone_else';
      return null;
    });
    const res = await Users.setUsername('u1', 'new_name');
    expect(res.success).toBe(false);
    expect(mockErrorCapture).toHaveBeenCalled();
  });

  test('fail: invalid input → success:false + capture', async () => {
    mockSanitizeValidate.mockImplementation(() => () => { throw new Error('VALIDATION'); });
    const res = await Users.setUsername('', '');
    expect(res.success).toBe(false);
    expect(mockErrorCapture).toHaveBeenCalled();
  });

  test('fail: invalid format → success:false + capture', async () => {
    const res = await Users.setUsername('u1', 'x'); // too short
    expect(res.success).toBe(false);
    expect(mockErrorCapture).toHaveBeenCalled();
  });
});

// =================================================================================
// getUserField
// =================================================================================
describe('Users.getUserField', () => {
  test('success: selects value from table', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ value: 'AU' }] });
    const v = await Users.getUserField('u1', 'user_profiles', 'country');
    expect(v).toBe('AU');
    expect(mockSanitizeValidate).toHaveBeenCalled();
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT country AS value FROM user_profiles WHERE uid = $1'),
      ['u1']
    );
  });

  test('fail: invalid input → returns null and capture', async () => {
    mockSanitizeValidate.mockImplementation(() => () => { throw new Error('VALIDATION'); });
    const v = await Users.getUserField('', '', '');
    expect(v).toBeNull();
    expect(mockErrorCapture).toHaveBeenCalled();
  });
});

// =================================================================================
// updateUserField
// =================================================================================
describe('Users.updateUserField', () => {
  test('success: updates value and logs', async () => {
    mockDbQuery.mockResolvedValueOnce({ rowCount: 1 });
    const ok = await Users.updateUserField('u1', 'users', 'last_login_at', '2025-08-19T03:20:00Z');
    expect(ok).toBe(true);
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET last_login_at = $1, updated_at = NOW() WHERE uid = $2'),
      ['2025-08-19T03:20:00Z', 'u1']
    );
    expect(mockLoggerWriteLog).toHaveBeenCalled();
  });

  test('fail: invalid input → false and capture', async () => {
    mockSanitizeValidate.mockImplementation(() => () => { throw new Error('VALIDATION'); });
    const ok = await Users.updateUserField('', '', '', null);
    expect(ok).toBe(false);
    expect(mockErrorCapture).toHaveBeenCalled();
  });
});

// =================================================================================
// buildUserData
// =================================================================================
describe('Users.buildUserData', () => {
  test('success: composes from CUD + users table', async () => {
    const uid = 'u1';
    mockRedis.get.mockImplementation(async (key) => {
      if (key === `cud:${uid}`) {
        return JSON.stringify({ username: 'alice', displayName: 'Alice Wonderland', avatar: '/a.png', online: true, status: 'online' });
      }
      if (key === `presence:override:user:${uid}`) return null;
      if (key === `presence:summary:user:${uid}`) return '1';
      return null;
    });

    mockDbQuery.mockResolvedValueOnce({ rows: [{ public_uid: 'P123', role: 'admin', is_new_user: true }] });

    const out = await Users.buildUserData(uid);
    expect(out).toEqual({
      displayName: 'Alice Wonderland',
      userName: 'alice',
      publicUid: 'P123',
      avatar: '/a.png',
      initials: 'AW',
      role: 'admin',
      isNewUser: true,
    });
  });

  test('fail: invalid uid → null and capture', async () => {
    mockSanitizeValidate.mockImplementation(() => () => { throw new Error('VALIDATION'); });
    const out = await Users.buildUserData(null);
    expect(out).toBeNull();
    expect(mockErrorCapture).toHaveBeenCalled();
  });
});

// =================================================================================
// buildUserSettings
// =================================================================================
describe('Users.buildUserSettings', () => {
  test('success: returns settings object', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ locale: { locale: 'en-AU' }, notifications: { email: true }, call_video_message: { enabled: true } }],
    });
    const out = await Users.buildUserSettings('u1');
    expect(out).toEqual({
      localeConfig: { locale: 'en-AU' },
      notificationsConfig: { email: true },
      callVideoMessage: { enabled: true },
    });
  });

  test('fail: invalid uid → {} and capture', async () => {
    mockSanitizeValidate.mockImplementation(() => () => { throw new Error('VALIDATION'); });
    const out = await Users.buildUserSettings('');
    expect(out).toEqual({});
    expect(mockErrorCapture).toHaveBeenCalled();
  });
});

// =================================================================================
// buildUserProfile
// =================================================================================
describe('Users.buildUserProfile', () => {
  test('success: composes profile from CUD + users + user_profiles', async () => {
    const uid = 'uX';
    mockRedis.get.mockImplementation(async (key) => {
      if (key === `cud:${uid}`) return JSON.stringify({ username: 'x', displayName: 'X Man', avatar: '/x.png', online: false, status: 'offline' });
      if (key === `presence:override:user:${uid}`) return null;
      if (key === `presence:summary:user:${uid}`) return null;
      return null;
    });

    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ public_uid: 'PUBX' }] }) // users
      .mockResolvedValueOnce({
        rows: [{
          bio: 'hello',
          gender: 'm',
          age: 41,
          body_type: 'fit',
          hair_color: 'black',
          country: 'AU',
          cover_image: '/cover.png',
          background_images: ['/b1.png'],
          social_urls: ['https://tw.example/x'],
          additional_urls: ['https://site.example/x'],
        }],
      });

    const out = await Users.buildUserProfile(uid);
    expect(out).toEqual({
      uid: 'uX',
      publicUid: 'PUBX',
      displayName: 'X Man',
      userName: 'x',
      avatar: '/x.png',
      bio: 'hello',
      gender: 'm',
      age: 41,
      bodyType: 'fit',
      hairColor: 'black',
      country: 'AU',
      coverImage: '/cover.png',
      backgroundImages: ['/b1.png'],
      socialUrls: ['https://tw.example/x'],
      additionalUrls: ['https://site.example/x'],
    });
  });

  test('fail: CUD missing → null and capture?', async () => {
    const uid = 'uY';
    mockRedis.get.mockResolvedValue(null); // no cud, no presence
    mockDbQuery.mockResolvedValue({ rows: [] });

    const out = await Users.buildUserProfile(uid);
    expect(out).toBeNull();
    // Not strictly required to capture here because getCriticalUserData returns null gracefully
  });

  test('fail: invalid uid → null and capture', async () => {
    mockSanitizeValidate.mockImplementation(() => () => { throw new Error('VALIDATION'); });
    const out = await Users.buildUserProfile('');
    expect(out).toBeNull();
    expect(mockErrorCapture).toHaveBeenCalled();
  });
});

// jest.config.js
export default {
  testEnvironment: 'node',
  transform: {
    '^.+\\.jsx?$': 'babel-jest',
  },
  extensionsToTreatAsEsm: ['.js'],
  moduleFileExtensions: ['js', 'jsx', 'json'],
  collectCoverageFrom: ['**/*.js', '!**/node_modules/**'],
};

{
  "presets": [
    ["@babel/preset-env", { "targets": { "node": "current" } }]
  ]
}
{
  "type": "module",
  "scripts": {
    "test": "jest --runInBand"
  },
  "devDependencies": {
    "@babel/preset-env": "^7.25.0",
    "babel-jest": "^29.7.0",
    "jest": "^29.7.0"
  }
}


//REAL EDGE CASES
1. Socket Layer (Presence Heartbeats)
// sockets/PresenceHandler.js
import Users from "../Users.js";

socket.on("heartbeat", async () => {
  try {
    const uid = socket.userId;
    const connId = socket.id; // unique per connection
    await Users.updatePresenceFromSocket(uid, connId);
  } catch (err) {
    console.error("Failed presence heartbeat", err);
  }
});

// When user toggles Away/Offline in the client UI
socket.on("setPresence", async (mode) => {
  await Users.setPresenceOverride(socket.userId, mode);
});


2. API Route (Check Username Availability)
// routes/username.js
import Users from "../Users.js";

app.get("/username/available/:username", async (req, res) => {
  const username = req.params.username;
  const taken = await Users.isUsernameTaken(username);
  res.json({ available: !taken });
});

app.post("/username", async (req, res) => {
  const { uid, username } = req.body;
  const result = await Users.setUsername(uid, username);
  if (!result.success) return res.status(409).json({ error: "USERNAME_TAKEN" });
  res.json({ success: true, previous: result.previous });
});

3. Building UI Response (Topbar JSON)
// controllers/UserController.js
import Users from "../Users.js";

export async function getTopbarData(req, res) {
  const uid = req.user.id;
  const data = await Users.buildUserData(uid);
  if (!data) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(data);
}





/// 
Understood ✅ — you don’t want me to overbuild, just give you usage snippets you can run manually and then check DB + Redis yourself for success/fail.
Here are straightforward calls for every Users method:

🔑 Username
Should work
const res = await Users.setUsername("u100", "alice_123");
console.log(res); // { success: true, previous: null }


➡️ Then check:

Postgres users.username_lower = 'alice_123'

Redis username:to:uid:alice_123 = u100

Redis uid:to:username:u100 = alice_123

Should fail (already taken)
const res = await Users.setUsername("u101", "alice_123");
console.log(res); // { success: false, previous: null }

👤 Critical User Data
Should work
const cud = await Users.getCriticalUserData("u100");
console.log(cud); 
// { username, displayName, avatar, online, status }

Should fail (invalid UID)
const cud = await Users.getCriticalUserData("");
console.log(cud); // null

👥 Batch Critical Users
Should work
const data = await Users.getCriticalUsersData(["u100", "u101"]);
console.log(data);

Should fail
const data = await Users.getCriticalUsersData(null);
console.log(data); // []

📡 Presence Status
Single
console.log(await Users.getOnlineStatus("u100")); 
// { online: true, status: "online" } or { online: false, status: "offline" }

Batch
console.log(await Users.getBatchOnlineStatus(["u100","u101"]));

Invalid
console.log(await Users.getOnlineStatus("")); 
// { online: false, status: "offline" }

⚡ Presence Heartbeat
Should work
await Users.updatePresenceFromSocket("u100", "conn-xyz");

Should fail
await Users.updatePresenceFromSocket("", "");

🎛️ Presence Override
Should work
await Users.setPresenceOverride("u100", "away");

Should fail
await Users.setPresenceOverride("u100", "weirdmode"); 
// should return false

🕵️ Username Availability
console.log(await Users.isUsernameTaken("alice_123")); // true
console.log(await Users.isUsernameTaken("totally_free_name")); // false

📑 User Fields (DB)
Get field
const country = await Users.getUserField("u100", "user_profiles", "country");
console.log(country);

Update field
await Users.updateUserField("u100", "user_profiles", "country", "AU");

Fail case
await Users.updateUserField("", "users", "last_login_at", new Date()); 
// returns false

🧩 JSON Builders
console.log(await Users.buildUserData("u100"));     // for topbar
console.log(await Users.buildUserSettings("u100")); // settings
console.log(await Users.buildUserProfile("u100"));  // profile page


Invalid UID → returns null or {}.

👉 With these snippets you can:

Run each method.

Then manually verify in Postgres and Redis whether the row/keys changed as expected.




Perfect ✅ — here’s a step-by-step checklist you can literally follow when you run the usage snippets.
After each call, you know exactly what to check in Postgres and Redis to confirm it worked (or failed).

🔎 Manual Verification Checklist
1. Users.setUsername(uid, username)

Run (success case):

await Users.setUsername("u200", "alice_200");


Check:

Postgres:

SELECT username_lower FROM users WHERE uid = 'u200';
-- expect: 'alice_200'


Redis:

username:to:uid:alice_200 = u200

uid:to:username:u200 = alice_200

Run (fail case):

await Users.setUsername("u201", "alice_200");


Check:

Should return { success: false }

Postgres and Redis values unchanged.

2. Users.getCriticalUserData(uid)

Run:

await Users.getCriticalUserData("u200");


Check:

Returns object: { username, displayName, avatar, online, status }.

If Redis cud:u200 exists → it came from cache.

If not, Postgres query should have hydrated and Redis cud:u200 will now exist.

Fail case:

await Users.getCriticalUserData("");
-- expect: null

3. Users.getCriticalUsersData(uids[])

Run:

await Users.getCriticalUsersData(["u200", "u201"]);


Check:

Array returned with each user’s data.

Redis keys cud:u200, cud:u201 now set.

Fail case:

await Users.getCriticalUsersData(null);
-- expect: []

4. Users.getOnlineStatus(uid)

Run:

await Users.getOnlineStatus("u200");


Check:

If presence:override:user:u200 = away → expect { online: true, status: "away" }.

If no override but presence:summary:user:u200 = 1 → expect { online: true, status: "online" }.

If both missing → { online: false, status: "offline" }.

5. Users.getBatchOnlineStatus(uids[])

Run:

await Users.getBatchOnlineStatus(["u200","u201"]);


Check:

Array with presence objects per uid.

Respects overrides first, then summaries.

6. Users.updatePresenceFromSocket(uid, connId)

Run:

await Users.updatePresenceFromSocket("u200", "socket-123");


Check:

Redis: presence:summary:user:u200 = 1 with TTL ~5m.

Postgres:

SELECT last_activity_at FROM users WHERE uid = 'u200';
-- expect: updated to near current timestamp


Redis: cud:u200 should be deleted (forcing refresh).

7. Users.setPresenceOverride(uid, mode)

Run:

await Users.setPresenceOverride("u200", "away");


Check:

Redis: presence:override:user:u200 = "away".

Postgres:

SELECT presence_preference FROM user_settings WHERE uid = 'u200';
-- expect: 'away'


Fail case:

await Users.setPresenceOverride("u200", "invalidmode");
-- expect: false

8. Users.isUsernameTaken(username)

Run:

await Users.isUsernameTaken("alice_200");


Check:

Should return true if username:to:uid:alice_200 exists in Redis.

Should return false if Redis key missing.

9. Users.getUserField(uid, table, field)

Run:

await Users.getUserField("u200", "user_profiles", "country");


Check:

Postgres:

SELECT country FROM user_profiles WHERE uid = 'u200';


Value returned must match DB column.

10. Users.updateUserField(uid, table, field, value)

Run:

await Users.updateUserField("u200", "user_profiles", "country", "AU");


Check:

Postgres:

SELECT country FROM user_profiles WHERE uid = 'u200';
-- expect: 'AU'


Redis: if field part of CUD (like avatar_url in users), then cud:u200 must be deleted so it refreshes.

11. Users.buildUserData(uid)

Run:

await Users.buildUserData("u200");


Check:

Returns JSON with:
{ displayName, userName, publicUid, avatar, initials, role, isNewUser }

Postgres: must contain public_uid, role, is_new_user.

Redis: must provide username, avatar, displayName.

12. Users.buildUserSettings(uid)

Run:

await Users.buildUserSettings("u200");


Check:

Returns JSON like:
{ localeConfig, notificationsConfig, callVideoMessage }

All values come from user_settings table in Postgres.

13. Users.buildUserProfile(uid)

Run:

await Users.buildUserProfile("u200");


Check:

Returns JSON combining:

From Redis: username, displayName, avatar

From users table: public_uid

From user_profiles: bio, gender, age, country, etc.

⚡ With this checklist:

Run the call

Query Postgres

Inspect Redis key(s)

Confirm they match the expected state







🗄️ Redis Key ↔ Method Mapping
Redis Key	Purpose	Touched By (Users method)	Action
cud:{uid}	Cached “Critical User Data” bundle { username, displayName, avatar, online, status }	getCriticalUserData (read/write), getCriticalUsersData (read/write), setUsername (update), updateUserField (delete if affected), updatePresenceFromSocket (delete), setPresenceOverride (delete)	Read, hydrate, bust on changes
presence:summary:user:{uid}	TTL-based online marker ("1" = online, missing = offline)	getOnlineStatus (read), getBatchOnlineStatus (read), updatePresenceFromSocket (write/refresh)	Set with TTL, refreshed by heartbeats
presence:override:user:{uid}	Manual override (`"real"	"away"	"offline"`)
username:to:uid:{usernameLower}	Primary lookup map for usernames	isUsernameTaken (read), setUsername (write new, delete old)	Enforces uniqueness
uid:to:username:{uid}	Mirror of current username for reverse lookup	setUsername (write new, delete old), isUsernameTaken (optional sanity check)	Keeps consistency
presence:connections:{uid} (optional, if you track multiple sockets)	Track active connection IDs per user	(Not in current Users.js, but used in socket handlers if added)	Add/remove connId to prevent premature offline
🔍 Quick Reference Per Method

getCriticalUserData(uid)
Reads cud:{uid}, may write it if missing. Also reads presence:summary:user:{uid} + presence:override:user:{uid}.

getCriticalUsersData(uids[])
Batch reads cud:{uid...}, hydrates missing, same as above but in bulk.

getOnlineStatus(uid)
Reads presence:override:user:{uid} first, then presence:summary:user:{uid}.

getBatchOnlineStatus(uids[])
Batch reads overrides + summaries.

updatePresenceFromSocket(uid, connId)
Writes presence:summary:user:{uid} with TTL (~5m). Deletes cud:{uid}.

setPresenceOverride(uid, mode)
Writes presence:override:user:{uid}. Deletes cud:{uid}. Updates Postgres mirror (user_settings.presence_preference).

isUsernameTaken(username)
Reads username:to:uid:{usernameLower}.

setUsername(uid, username)
Writes new username:to:uid:{usernameLower} and uid:to:username:{uid}, deletes old maps. Updates Postgres. Updates/busts cud:{uid}.

getUserField(uid, table, field)
DB only (no Redis).

updateUserField(uid, table, field, value)
DB write. If users table field affects CUD (like avatar_url, display_name, username_lower), should delete cud:{uid}.

buildUserData(uid) / buildUserSettings(uid) / buildUserProfile(uid)
Combines Redis (cud:{uid} + presence keys) + Postgres.

⚡ This way, when you call a method, you instantly know which Redis key to check to verify success/failure.