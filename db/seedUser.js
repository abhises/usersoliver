import DB from "../utils/DB.js";

async function seedTestUsers() {
  const db = new DB();

  try {
    // Delete existing Alice/Bob
    await db.query(
      "default",
      "DELETE FROM users WHERE username_lower IN ($1, $2)",
      ["alice", "bob"]
    );

    // Insert Alice
    await db.insert("default", "users", {
      uid: "u1",
      username_lower: "alice",
      display_name: "Alice Doe",
      avatar_url: "/a.png",
    });

    // Insert Bob
    await db.insert("default", "users", {
      uid: "u2",
      username_lower: "bob",
      display_name: "Bob Smith",
      avatar_url: "/b.png",
    });

    // Verify
    const users = await db.getAll(
      "default",
      "SELECT uid, username_lower, display_name, avatar_url FROM users WHERE username_lower IN ($1, $2)",
      ["alice", "bob"]
    );

    console.log("Seeded users:", users);
  } catch (err) {
    console.error("❌ Seeding failed:", err);
  } finally {
    await db.closeAll();
  }
}

seedTestUsers();
