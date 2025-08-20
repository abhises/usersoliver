import DB from "../utils/DB.js";

async function seedAllTables() {
  const db = new DB();

  try {
    await db.ensureConnected();

    // --- Cleanup existing test data
    await db.query(
      "default",
      "DELETE FROM user_settings WHERE uid IN ($1, $2)",
      ["u1", "u2"]
    );
    await db.query(
      "default",
      "DELETE FROM user_profiles WHERE uid IN ($1, $2)",
      ["u1", "u2"]
    );
    await db.query("default", "DELETE FROM users WHERE uid IN ($1, $2)", [
      "u1",
      "u2",
    ]);

    // --- Insert Users
    await db.insert("default", "users", {
      uid: "u1",
      username_lower: "alice",
      display_name: "Alice Doe",
      avatar_url: "/a.png",
    });

    await db.insert("default", "users", {
      uid: "u2",
      username_lower: "bob",
      display_name: "Bob Smith",
      avatar_url: "/b.png",
    });

    // --- Insert User Settings
    await db.insert("default", "user_settings", {
      uid: "u1",
      locale: "en",
      notifications: JSON.stringify({ email: true, sms: false }),
      call_video_message: true,
      presence_preference: "online",
    });

    await db.insert("default", "user_settings", {
      uid: "u2",
      locale: "fr",
      notifications: JSON.stringify({ email: false, push: true }),
      call_video_message: false,
      presence_preference: "away",
    });

    // --- Insert User Profiles
    await db.insert("default", "user_profiles", {
      uid: "u1",
      bio: "Hi, I'm Alice!",
      gender: "female",
      age: 28,
      body_type: "athletic",
      hair_color: "blonde",
      country: "USA",
      cover_image: "/covers/a1.png",
      background_images: ["bg1.png", "bg2.png"],
      social_urls: ["https://twitter.com/alice"],
      additional_urls: ["https://alice.dev"],
    });

    await db.insert("default", "user_profiles", {
      uid: "u2",
      bio: "Hey, Bob here.",
      gender: "male",
      age: 32,
      body_type: "average",
      hair_color: "brown",
      country: "Canada",
      cover_image: "/covers/b1.png",
      background_images: ["bg3.png"],
      social_urls: ["https://github.com/bob"],
      additional_urls: [],
    });

    // --- Verify
    const users = await db.getAll(
      "default",
      "SELECT u.uid, u.username_lower, u.display_name, us.presence_preference, up.country FROM users u LEFT JOIN user_settings us ON u.uid = us.uid LEFT JOIN user_profiles up ON u.uid = up.uid WHERE u.uid IN ($1, $2)",
      ["u1", "u2"]
    );

    console.log("✅ Seeded data:", users);
  } catch (err) {
    console.error("❌ Seeding failed:", err);
  } finally {
    await db.closeAll();
  }
}

seedAllTables();
