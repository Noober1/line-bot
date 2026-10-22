import { handleRequest } from "./src/app";
import { loadConfig, type Config } from "./src/config";

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(`Config error: ${(error as Error).message}`);
  process.exit(1);
}

const server = Bun.serve({ port: config.port, fetch: handleRequest });
console.log(`Listening on ${server.url}`);
