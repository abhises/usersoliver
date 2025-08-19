import pkg from "pg";
const { Pool } = pkg;
import "dotenv/config";

export default class DB {
  constructor() {
    this.connections = {};
    this.errors = [];
    this.defaultConfig = {
      user: process.env.POSTGRES_USER,
      host: process.env.PGHOST || "localhost",
      database: process.env.POSTGRES_DB,
      password: process.env.POSTGRES_PASSWORD,
      port: parseInt(process.env.PGPORT, 10) || 5000,
    };
  }

  async ensureConnected(name = "default") {
    if (!this.connections[name]) {
      this.connections[name] = new Pool(this.defaultConfig);
      try {
        const client = await this.connections[name].connect();
        client.release();
      } catch (err) {
        this.errors.push(err.message);
        throw err;
      }
    }
  }

  async query(name = "default", text = "", params = []) {
    await this.ensureConnected(name);
    try {
      const result = await this.connections[name].query(text, params);
      return result;
    } catch (err) {
      this.errors.push(err.message);
      throw err;
    }
  }

  async getRow(name = "default", text = "", params = []) {
    const result = await this.query(name, text, params);
    return result.rows[0] || null;
  }

  async getAll(name = "default", text = "", params = []) {
    const result = await this.query(name, text, params);
    return result.rows;
  }

  async insert(name = "default", table = "", data = {}) {
    await this.ensureConnected(name);
    if (!table || !data || Object.keys(data).length === 0) {
      throw new Error("Invalid table or data for insert.");
    }
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`);

    const sql = `INSERT INTO ${table} (${keys.join(
      ","
    )}) VALUES (${placeholders.join(",")}) RETURNING *`;
    const result = await this.query(name, sql, values);
    return result.rows[0] || null;
  }

  async update(
    name = "default",
    table = "",
    data = {},
    where = "",
    params = []
  ) {
    await this.ensureConnected(name);
    if (!table || !data || Object.keys(data).length === 0 || !where) {
      throw new Error("Invalid table, data, or where clause for update.");
    }
    const keys = Object.keys(data);
    const values = Object.values(data);

    // Prepare SET clause placeholders starting at $1
    const setClause = keys.map((key, i) => `${key}=$${i + 1}`).join(", ");

    // Shift placeholders in WHERE clause by keys.length to avoid conflicts
    const whereWithShiftedPlaceholders = where.replace(
      /\$(\d+)/g,
      (match, p1) => {
        return `$${parseInt(p1) + keys.length}`;
      }
    );

    const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereWithShiftedPlaceholders} RETURNING *`;

    // Combine values for SET and params for WHERE
    const result = await this.query(name, sql, [...values, ...params]);
    return result.rows;
  }

  async delete(name = "default", table = "", where = "", params = []) {
    await this.ensureConnected(name);
    if (!table || !where) {
      throw new Error("Invalid table or where clause for delete.");
    }
    const sql = `DELETE FROM ${table} WHERE ${where} RETURNING *`;
    const result = await this.query(name, sql, params);
    return result.rows;
  }

  getErrors() {
    return this.errors;
  }

  async closeAll() {
    for (const name in this.connections) {
      await this.connections[name].end();
    }
    this.connections = {};
  }
}
