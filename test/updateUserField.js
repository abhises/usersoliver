import Users from "../service/Users.js";

export default async function testUpdateUserField() {
  const result = await Users.updateUserField(
    "u200",
    "user_profiles",
    "country",
    "AU"
  );

  console.log("result", result);

  const result2 = await Users.updateUserField(
    "u1",
    "user_profiles",
    "age",
    "50"
  );

  console.log("result", result2);
}
testUpdateUserField();
