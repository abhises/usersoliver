import Users from "../service/Users.js";

export default async function testGetUserField() {
  const result = await Users.getUserField("u200", "user_profiles", "country");

  console.log("result", result);
}
testGetUserField();
