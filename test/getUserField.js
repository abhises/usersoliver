import Users from "../service/Users.js";

export default async function testGetUserField() {
  const result1 = await Users.getUserField("u200", "user_profiles", "country");

  console.log("result1", result1);
  const result2 = await Users.getUserField("u1", "user_profiles", "country");

  console.log("result2", result2);

  const result3 = await Users.getUserField("u1", "user_profiles", "age");

  console.log("result3", result3);
}
testGetUserField();
