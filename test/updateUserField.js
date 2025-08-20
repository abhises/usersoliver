import Users from "../service/Users.js";

export default async function testUpdateUserField() {
  const result = await Users.updateUserField(
    "u200",
    "user_profiles",
    "country",
    "AU"
  );

  console.log("result", result);
}
testUpdateUserField();
