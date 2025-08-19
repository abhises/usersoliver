import "dotenv/config";
import DB from "./utils/DB.js"; // adjust path if needed

const db = new DB();

async function createTestTable() {
  try {
    await db.ensureConnected();

    const sql = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await db.query("default", sql);
    console.log("✅ test_users table created successfully");
  } catch (err) {
    console.error("❌ Error creating table:", err.message);
  } finally {
    await db.closeAll();
  }
}

createTestTable();
