import "dotenv/config";
import DB from "../utils/DB.js"; // adjust path if needed

const db = new DB();

async function dropTables() {
  try {
    await db.ensureConnected();

    // Drop tables in the correct order to avoid foreign key conflicts
    await db.query(
      "default",
      `
      DROP TABLE IF EXISTS user_settings CASCADE;
    `
    );

    await db.query(
      "default",
      `
      DROP TABLE IF EXISTS user_profiles CASCADE;
    `
    );

    await db.query(
      "default",
      `
      DROP TABLE IF EXISTS users CASCADE;
    `
    );

    console.log(
      "✅ Tables dropped successfully (users, user_settings, user_profiles)"
    );
  } catch (err) {
    console.error("❌ Error dropping tables:", err.message);
  } finally {
    await db.closeAll();
  }
}

dropTables();
