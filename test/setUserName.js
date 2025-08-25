import Users from "../service/Users.js";

export default async function setUserNameTest() {
  const res = await Users.setUsername("u10", "delish");
  console.log(res); // { success: true, previous: null }

  // ➡️ Then check:

  // Postgres users.username_lower = 'alice_123'

  // Redis username:to:uid:alice_123 = u100

  // Redis uid:to:username:u100 = alice_123

  // Should fail (already taken)
  const res2 = await Users.setUsername("u1", "nepali4");
  console.log(res2); // { success: false, previous: null }

  const res3 = await Users.setUsername("u3", "alice4224");
  console.log(res3); // { success: false, previous: null }
}

setUserNameTest();
