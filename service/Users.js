import {
  ErrorHandler,
  Logger,
  db,
  SafeUtils,
  RedisClient,
} from "../utils/index.js";

export default class Users {
  static REDIS_KEY_PREFIX = Object.freeze({
    CRITICAL_USER_DATA: "cud:",
    PRESENCE_SUMMARY_USER: "presence:summary:user:",
    PRESENCE_OVERRIDE_USER: "presence:override:user:",
    USERNAME_TO_UID: "username:to:uid:",
    UID_TO_USERNAME: "uid:to:username:",
  });

  static REDIS_TIMING_SECONDS = Object.freeze({
    HEARTBEAT_INTERVAL: 25,
    PRESENCE_TTL: 300,
    CRITICAL_USER_DATA_TTL: 300,
  });

  static PRESENCE_MODE = Object.freeze({
    REAL: "real",
    AWAY: "away",
    OFFLINE: "offline",
  });

  static USERNAME_POLICY = Object.freeze({
    MIN_LEN: 3,
    MAX_LEN: 30,
    REGEX: /^[a-zA-Z0-9._-]{3,30}$/,
  });

  static LOGGER_FLAG_USERS = "users";

  /* ================================
   HELPER FUNCTIONS (INTERNAL)
   ================================ */

  /**
   * Normalize username to lowercase, trimmed.
   * @param {string} username
   */
  static normalizeUsername(username) {
    const safe = (username ?? "").toString().trim().toLowerCase();
    // console.log("Normalizing username:", safe);
    return safe;
  }

  /**
   * Validate username format against policy.
   * @param {string} username
   * @returns {boolean}
   */
  static isUsernameFormatValid(username) {
    const u = this.normalizeUsername(username);
    if (
      u.length < this.USERNAME_POLICY.MIN_LEN ||
      u.length > this.USERNAME_POLICY.MAX_LEN
    )
      return false;
    return this.USERNAME_POLICY.REGEX.test(u);
  }

  /**
   * Compute initials from a display name.
   * @param {string} displayName
   * @returns {string}
   */
  static initialsFromDisplayName(displayName) {
    const parts = (displayName ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return parts.map((p) => (p[0] || "").toUpperCase()).join("");
  }

  /**
   * Build Redis keys
   */
  static keyCriticalUserData(uid) {
    return `${Users.REDIS_KEY_PREFIX.CRITICAL_USER_DATA}${uid}`;
  }
  static keyPresenceSummary(uid) {
    return `${Users.REDIS_KEY_PREFIX.PRESENCE_SUMMARY_USER}${uid}`;
  }
  static keyPresenceOverride(uid) {
    // console.log("Building keyPresenceOverride for UID:", uid);
    // console.log(
    //   "this.REDIS_KEY_PREFIX keys:",
    //   `${Users.REDIS_KEY_PREFIX.PRESENCE_OVERRIDE_USER}${uid}`
    // );
    return `${Users.REDIS_KEY_PREFIX.PRESENCE_OVERRIDE_USER}${uid}`;
  }
  static keyUsernameToUid(name) {
    return `${Users.REDIS_KEY_PREFIX.USERNAME_TO_UID}${Users.normalizeUsername(
      name
    )}`;
  }
  static keyUidToUsername(uid) {
    return `${Users.REDIS_KEY_PREFIX.UID_TO_USERNAME}${uid}`;
  }
  /**
   * Read JSON value from Redis (string→object).
   */
  static async redisGetJson(key) {
    const raw = await RedisClient.get(key);
    if (!raw) return null;
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  }

  static validateInputs(rulesObject) {
    // Example: SafeUtils.sanitizeValidate({ uid: 'required|string|trim' }, data)
    // We will assume SafeUtils.sanitizeValidate returns sanitized data or throws.
    // console.log("Validating inputs:", rulesObject);
    return SafeUtils.sanitizeValidate(rulesObject);
  }

  /**
   * Set JSON value in Redis with TTL (seconds).
   */
  static async redisSetJson(key, obj, ttlSeconds = 0) {
    const value = JSON.stringify(obj ?? {});
    if (ttlSeconds > 0) {
      await RedisClient.set(key, value, { expiry: ttlSeconds });
    } else {
      await RedisClient.set(key, value);
    }
  }

  /**
   * Validate inputs via SafeUtils.sanitizeValidate (REQUIRED).
   * Throws if invalid.
   */

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
      const { uid: vUid } = this.validateInputs({
        uid: { value: uid, type: "string", required: true, trim: true },
      });
      // console.log("uid inside the get critical ", vUid);
      // 1) Try Redis CUD
      const cudKey = this.keyCriticalUserData(vUid);
      // console.log("cudKey", cudKey);

      let cud = await this.redisGetJson(cudKey);

      // console.log(cud);

      // 2) Merge presence (override→summary) from Redis every read
      const presence = await this.getOnlineStatus(vUid);

      if (cud) {
        const merged = {
          ...cud,
          online: presence.online,
          status: presence.status,
        };
        return merged;
      }

      // 3) Hydrate from Postgres (durables) — minimal SELECT to get username/displayName/avatar
      // console.log("cudKey", cudKey);

      const userRow = await db.query(
        "default", // connection name
        "SELECT username_lower AS username, display_name AS display_name, avatar_url AS avatar FROM users WHERE uid = $1 LIMIT 1",
        [vUid]
      );
      // console.log("userRow", userRow);
      const record = userRow?.rows?.[0];
      // console.log("record", record);
      if (!record) return null;

      const hydrated = {
        username: record.username || "",
        displayName: record.display_name || "",
        avatar: record.avatar || "",
        online: presence.online,
        status: presence.status,
      };
      // console.log("hydrated user", hydrated);

      // 4) Warm Redis CUD
      await redisSetJson(
        cudKey,
        hydrated,
        this.REDIS_TIMING_SECONDS.CRITICAL_USER_DATA_TTL
      );

      Logger.writeLog?.({
        flag: this.LOGGER_FLAG_USERS,
        action: "getCriticalUserData_hydrated",
        message: "Hydrated CUD from Postgres and cached in Redis",
        data: { uid: vUid },
      });

      return hydrated;
    } catch (err) {
      ErrorHandler.capture?.(err, { where: "Users.getCriticalUserData", uid });
      return {
        status: false,
        data: null,
        error: err.message || "UNKNOWN_ERROR",
      };
    }
  }

  /**
   * Batched critical user data by UIDs (order-preserving). Redis-first; hydrate misses.
   * @param {string[]} uids
   * @returns {Promise<Array<object>>}
   */
  static async getCriticalUsersData(uids = []) {
    try {
      const { uids: vUids } = this.validateInputs({
        uids: { value: uids, type: "array", required: true, min: 1, max: 200 },
      });
      // console.log("Validated UIDs:", vUids);

      // 1) MGET CUD keys
      const keys = vUids.map(this.keyCriticalUserData);
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
        results.push({
          uid: mUid,
          ...(one || {
            username: "",
            displayName: "",
            avatar: "",
            online: false,
            status: "offline",
          }),
        });
      }

      // 3) Preserve input order
      const map = new Map(results.map((r) => [r.uid, r]));
      return vUids.map((u) => map.get(u));
    } catch (err) {
      ErrorHandler.capture?.(err, {
        where: "Users.getCriticalUsersData",
        uids,
      });
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
      const { uid: vUid } = validateInputs({
        uid: { value: uid, type: "string", required: true, trim: true },
      });

      // 1) Check override
      const override = await RedisClient.get(this.keyPresenceOverride(vUid));
      if (override === this.PRESENCE_MODE.OFFLINE)
        return { online: false, status: "offline" };
      if (override === this.PRESENCE_MODE.AWAY)
        return { online: true, status: "away" };

      // 2) Check summary key
      const summary = await RedisClient.get(this.keyPresenceSummary(vUid));
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
      const { uids: vUids } = this.validateInputs({
        uids: { value: uids, type: "array", required: true, min: 1, max: 500 },
      });

      // console.log("Validated UIDs:", vUids);

      // overrides
      const overrideKeys = vUids.map(this.keyPresenceOverride);
      // console.log("Override keys:", overrideKeys);
      const overrides = await RedisClient.mget(...overrideKeys);
      // console.log("Overrides:", overrides);
      // summaries
      const summaryKeys = vUids.map(this.keyPresenceSummary);
      const summaries = await RedisClient.mget(...summaryKeys);

      const out = [];
      for (let i = 0; i < vUids.length; i++) {
        const uid = vUids[i];
        const ov = overrides[i];
        if (ov === this.PRESENCE_MODE.OFFLINE) {
          out.push({ uid, online: false, status: "offline" });
          continue;
        }
        if (ov === this.PRESENCE_MODE.AWAY) {
          out.push({ uid, online: true, status: "away" });
          continue;
        }

        const isOnline = !!summaries[i];
        out.push({
          uid,
          online: isOnline,
          status: isOnline ? "online" : "offline",
        });
      }
      return out;
    } catch (err) {
      ErrorHandler.capture?.(err, {
        where: "Users.getBatchOnlineStatus",
        uids,
      });
      return { success: false, data: [], error: err.message };
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
      const { uid: vUid, connId: vConnId } = this.validateInputs({
        uid: { value: uid, type: "string", required: true, trim: true },
        connId: { value: connId, type: "string", required: true, trim: true },
      });

      // Refresh presence summary TTL
      await RedisClient.set(this.keyPresenceSummary(vUid), "1", {
        expiry: this.REDIS_TIMING_SECONDS.PRESENCE_TTL,
      });

      // OPTIONAL: Throttle durable lastActivityAt write in Postgres (e.g., once per 60s)
      // Reads are Redis-only; this is purely for analytics/labels.
      const update = await db.query(
        "default",
        "UPDATE users SET last_activity_at = NOW() WHERE uid = $1 AND (last_activity_at IS NULL OR NOW() - last_activity_at > INTERVAL '60 seconds ')",
        [vUid]
      );
      // const result = await db.query(
      //   "default",
      //   `
      //   UPDATE users
      //   SET last_activity_at = NOW()
      //   WHERE uid = $1
      //     AND (last_activity_at IS NULL OR NOW() - last_activity_at > INTERVAL '60 seconds')
      //   RETURNING *
      //   `,
      //   [vUid]
      // );
      console.log("Update result:", update);

      // Bust CUD so next read merges fresh presence if needed
      await RedisClient.del(this.keyCriticalUserData(vUid));
      Logger.writeLog?.({
        flag: this.LOGGER_FLAG_USERS,
        action: "updatePresenceFromSocket",
        message: "Presence heartbeat processed",
        data: { uid: vUid, connId: vConnId },
      });
      return update;
    } catch (err) {
      ErrorHandler.capture?.(err, {
        where: "Users.updatePresenceFromSocket",
        uid,
        connId,
      });
      return { success: false, error: err.message || "UNKNOWN_ERROR" };
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
      const { uid: vUid, mode: vMode } = this.validateInputs({
        uid: { value: uid, type: "string", required: true, trim: true },
        mode: { value: mode, type: "string", required: true, trim: true },
      });

      // console.log("setPresenceOverride", { uid: vUid, mode: vMode });
      await RedisClient.set(this.keyPresenceOverride(vUid), vMode); // no TTL
      await RedisClient.del(this.keyCriticalUserData(vUid)); // bust CUD

      // Persist preference for rebuild only
      const result = await db.query(
        "default",
        "UPDATE user_settings SET presence_preference = $1, updated_at = NOW() WHERE uid = $2 RETURNING *",
        [vMode, vUid]
      );
      if (!result?.rows[0]) {
        throw new Error("PERSISTENCE_FAILED");
      }
      // console.log("result", result.rows);
      Logger.writeLog?.({
        flag: this.LOGGER_FLAG_USERS,
        action: "setPresenceOverride",
        message: "Presence override updated",
        data: { uid: vUid, mode: vMode },
      });

      return result?.rows[0];
    } catch (err) {
      ErrorHandler.capture?.(err, {
        where: "Users.setPresenceOverride",
        uid,
        mode,
      });
      return { success: false, error: err.message };
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
      const { username: vUsername } = this.validateInputs({
        username: {
          value: username,
          type: "string",
          required: true,
          trim: true,
        },
      });

      if (!this.isUsernameFormatValid(vUsername)) return true; // invalid format treated as not available
      console.log("hi");
      const ownerUid = await RedisClient.get(this.keyUsernameToUid(vUsername));
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
    // console.log("Setting username:", uid, username);
    try {
      const { uid: vUid, username: vUsernameRaw } = this.validateInputs({
        uid: { value: uid, type: "string", required: true, trim: true },
        username: {
          value: username,
          type: "string",
          required: true,
          trim: true,
        },
      });

      console.log("Setting username: lower", vUid, vUsernameRaw);

      const vUsername = this.normalizeUsername(vUsernameRaw);
      if (!this.isUsernameFormatValid(vUsername)) {
        throw new Error("INVALID_USERNAME_FORMAT");
      }
      // console.log("Setting username: normalized");

      const mapKey = this.keyUsernameToUid(vUsername);
      console.log("Setting username: mapKey", mapKey);

      // Atomic claim: if key exists and not owned by uid -> conflict
      const existingOwner = await RedisClient.get(mapKey);
      // console.log("Setting username: existingOwner", existingOwner);
      if (existingOwner && existingOwner !== vUid) {
        throw new Error("USERNAME_TAKEN");
      }

      // Fetch previous username (if any) from mirror
      const oldUsername = await RedisClient.get(this.keyUidToUsername(vUid));

      // Set mappings
      await RedisClient.set(mapKey, vUid);
      await RedisClient.set(this.keyUidToUsername(vUid), vUsername);

      // Update durable copy

      const rows = await db.query(
        "default",
        "UPDATE users SET username_lower = $1, updated_at = NOW() WHERE uid = $2 RETURNING *",
        [vUsername, vUid]
      );
      console.log("Updated rows:", rows.rows);

      // Update CUD cache if exists
      const cudKey = this.keyCriticalUserData(vUid);
      const cud = await this.redisGetJson(cudKey);
      if (cud) {
        cud.username = vUsername;
        await this.redisSetJson(
          cudKey,
          cud,
          this.REDIS_TIMING_SECONDS.CRITICAL_USER_DATA_TTL
        );
      }

      Logger.writeLog?.({
        flag: this.LOGGER_FLAG_USERS,
        action: "setUsername",
        message: "Username claimed/updated",
        data: { uid: vUid, username: vUsername, previous: oldUsername || null },
      });

      // If username changed, optionally free old map entry
      if (oldUsername && oldUsername !== vUsername) {
        const oldMapKey = this.keyUsernameToUid(oldUsername);
        const currOwner = await RedisClient.get(oldMapKey);
        if (currOwner === vUid) {
          await RedisClient.del(oldMapKey);
        }
      }

      return { success: true, previous: oldUsername || undefined };
    } catch (err) {
      ErrorHandler.capture?.(err, {
        where: "Users.setUsername",
        uid,
        username,
      });
      return { success: false, error: err.message || "UNKNOWN_ERROR" };
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
      const {
        uid: vUid,
        tableName: vTable,
        fieldKey: vField,
      } = this.validateInputs({
        uid: { value: uid, type: "string", required: true, trim: true },
        tableName: {
          value: tableName,
          type: "string",
          required: true,
          trim: true,
        },
        fieldKey: {
          value: fieldKey,
          type: "string",
          required: true,
          trim: true,
        },
      });
      // console.log("getUserField", {
      //   uid: vUid,
      //   tableName: vTable,
      //   fieldKey: vField,
      // });
      // Securely whitelist table and field names if you maintain an allowlist.
      // For now, parameterize value and use dynamic identifiers cautiously.
      const sql = `SELECT ${vField} AS value FROM ${vTable} WHERE uid = $1 LIMIT 1`;
      const res = await db.query("default", sql, [vUid]);
      // console.log("getUserField result:", res);
      if (!res?.rows?.[0]) {
        throw new Error("GetUserField_FAILED");
      }
      return res?.rows?.[0];
    } catch (err) {
      ErrorHandler.capture?.(err, {
        where: "Users.getUserField",
        uid,
        tableName,
        fieldKey,
      });
      return { success: false, error: err.message || "UNKNOWN_ERROR" };
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
      const {
        uid: vUid,
        tableName: vTable,
        fieldKey: vField,
      } = this.validateInputs({
        uid: { value: uid, type: "string", required: true, trim: true },
        tableName: {
          value: tableName,
          type: "string",
          required: true,
          trim: true,
          lowercase: true,
        },
        fieldKey: {
          value: fieldKey,
          type: "string",
          required: true,
          trim: true,
          lowercase: true,
        },
        value: {
          value,
          type: "string",
          required: true,
          trim: true,
          lowercase: true,
        },
      });
      // console.log("updateUserField", {
      //   uid: vUid,
      //   tableName: vTable,
      //   fieldKey: vField,
      //   value: value,
      // });

      // For timestamps, caller can pass value or use DateTime to generate now.
      const res = await db.query(
        "default",
        `UPDATE ${vTable} SET ${vField} = $1, updated_at = NOW() WHERE uid = $2`,
        [value, vUid]
      );
      // console.log("updateUserField result:", res);
      Logger.writeLog?.({
        flag: this.LOGGER_FLAG_USERS,
        action: "updateUserField",
        message: "Durable field updated",
        data: { uid: vUid, tableName: vTable, fieldKey: vField },
      });
      if (res.rowCount === 0) {
        throw new Error("UpdateUserField_FAILED:user not found");
      }

      return { success: true };
    } catch (err) {
      ErrorHandler.capture?.(err, {
        where: "Users.updateUserField",
        uid,
        tableName,
        fieldKey,
      });
      return { success: false, error: err.message || "UNKNOWN_ERROR" };
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
      const { uid: vUid } = this.validateInputs({
        uid: { value: uid, type: "string", required: true, trim: true },
      });
      const cud = await this.getCriticalUserData(vUid);
      if (!cud) return null;

      const row = await db.query(
        "default",
        "SELECT public_uid AS public_uid, role, is_new_user FROM users WHERE uid = $1 LIMIT 1",
        [vUid]
      );
      // console.log("buildUserData row:", row.rows);
      const base = row?.rows?.[0] || {};

      const out = {
        displayName: cud.displayName || "",
        userName: cud.username || "",
        publicUid: base.public_uid || "",
        avatar: cud.avatar || "",
        initials: this.initialsFromDisplayName(cud.displayName || ""),
        role: base.role || "user",
        isNewUser: !!base.is_new_user,
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
      const { uid: vUid } = this.validateInputs({
        uid: { value: uid, type: "string", required: true, trim: true },
      });
      const res = await db.query(
        "default",
        "SELECT locale, notifications, call_video_message FROM user_settings WHERE uid = $1 LIMIT 1",
        [vUid]
      );
      // console.log("buildUserSettings row:", res.rows);
      const s = res?.rows?.[0] || {};
      return {
        localeConfig: s.locale ?? null,
        notificationsConfig: s.notifications ?? null,
        callVideoMessage: s.call_video_message ?? null,
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
      const { uid: vUid } = this.validateInputs({
        uid: { value: uid, type: "string", required: true, trim: true },
      });

      const cud = await this.getCriticalUserData(vUid);
      const userRes = await db.query(
        "default",
        "SELECT public_uid FROM users WHERE uid = $1 LIMIT 1",
        [vUid]
      );
      const profRes = await db.query(
        "default",
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
        additionalUrls: prof.additional_urls || [],
      };
    } catch (err) {
      ErrorHandler.capture?.(err, { where: "Users.buildUserProfile", uid });
      return null;
    }
  }
}
