import Users from "../service/Users.js";

export default async function testIsUsernameTaken() {
  const result = await Users.isUsernameTaken("alice_200");

  console.log("result", result);
}
testIsUsernameTaken();
