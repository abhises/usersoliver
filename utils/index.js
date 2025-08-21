// utils/index.js
import ErrorHandler from "./ErrorHandler.js";
import logger from "./UtilityLogger.js";
import DateTime from "./DateTime.js";
import SafeUtils from "./SafeUtils.js";
import RedisClient from "./Redis.js";
import DB from "./DB.js";

const db = new DB();
const Logger = new logger();

export { ErrorHandler, Logger, db, DateTime, SafeUtils, RedisClient };
