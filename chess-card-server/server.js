require("dotenv").config();
const express = require("express");
const path = require("path");
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
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Define Game model
const GameSchema = new mongoose.Schema({
  boardState: String,             // FEN notation of the board
  playerHands: {                  // Cards for each player
    white: Array,
    black: Array
  },
  turn: String,                   // "white" or "black"
  messages: Array,
  createdAt: { type: Date, default: Date.now }
});
const Game = mongoose.model("Game", GameSchema);

// API endpoint: Create a new game
app.post("/create-game", async (req, res) => {
  try {
    const newGame = new Game({
      boardState: "start",
      playerHands: { white: [], black: [] },
      turn: "white",
      messages: ["Game started."]
    });
    await newGame.save();
    res.json(newGame);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API endpoint: Get game state by ID
app.get("/game/:id", async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ error: "Game not found" });
    res.json(game);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.io integration for real-time game updates
io.on("connection", (socket) => {
  console.log("👤 A player connected:", socket.id);

  socket.on("join-game", async (gameId) => {
    if (!gameId) return;
    socket.join(gameId);
    // Get number of clients in the room:
    const clients = io.sockets.adapter.rooms.get(gameId);
    const numClients = clients ? clients.size : 0;
    // Emit the updated player count to everyone in the room
    io.to(gameId).emit("player-count", numClients);
    console.log(`Player joined game: ${gameId} (Total: ${numClients})`);
  });
  

  socket.on("move-piece", async (data) => {
    const { gameId, fen } = data;
    const game = await Game.findByIdAndUpdate(gameId, { boardState: fen });
    if (game) {
      io.to(gameId).emit("update-board", fen);
    }
  });

  socket.on("disconnect", () => {
    console.log("🚪 A player disconnected:", socket.id);
  });
});

// Default route for health check
app.get("/", (req, res) => {
  res.send("✅ Chess game server is running!");
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
