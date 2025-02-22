require("dotenv").config();
const express = require("express");
const path = require("path"); // Add path module
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all frontend connections
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json()); // Middleware for JSON parsing

// ✅ Move `express.static()` after `app` initialization
app.use(express.static(path.join(__dirname, "public")));

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ✅ Default route for health check
app.get("/", (req, res) => {
  res.send("✅ Chess game server is running!");
});

// ✅ Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
