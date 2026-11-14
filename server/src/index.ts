import "dotenv/config";
import http from "node:http";
import { createApp } from "./app.js";
import { wsService } from "./ws/WebSocketService.js";
import { whatsAppService } from "./services/WhatsAppService.js";

const PORT = process.env.PORT || 3001;
const app = createApp();
const server = http.createServer(app);

wsService.attach(server);

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  whatsAppService.connect();
});
