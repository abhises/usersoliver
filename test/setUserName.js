import Users from "../service/Users.js";

export default async function setUserNameTest() {
  const res = await Users.setUsername("u2", "alice_12322");
  console.log(res); // { success: true, previous: null }

  // ➡️ Then check:

  // Postgres users.username_lower = 'alice_123'

  // Redis username:to:uid:alice_123 = u100

  // Redis uid:to:username:u100 = alice_123

  // Should fail (already taken)
  const res2 = await Users.setUsername("u1", "alice_123422");
  console.log(res2); // { success: false, previous: null }
}

setUserNameTest();
