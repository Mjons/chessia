require("dotenv").config();
const express = require("express");
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
app.use(express.json()); // Middleware for JSON parsing

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("MongoDB connected"))
  .catch(err => console.error("MongoDB connection error:", err));

// Game model
const GameSchema = new mongoose.Schema({
  boardState: String, // FEN notation of the board
  playerHands: {
    white: Array,
    black: Array
  },
  turn: String, // "white" or "black"
  messages: Array,
  createdAt: { type: Date, default: Date.now }
});

const Game = mongoose.model("Game", GameSchema);

// Create a new game
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

// Get game state
app.get("/game/:id", async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ error: "Game not found" });

    res.json(game);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// WebSockets for real-time updates
io.on("connection", (socket) => {
  console.log("A player connected:", socket.id);

  socket.on("join-game", async (gameId) => {
    socket.join(gameId);
    console.log(`Player joined game: ${gameId}`);
  });

  socket.on("move-piece", async (data) => {
    const { gameId, fen } = data;
    const game = await Game.findByIdAndUpdate(gameId, { boardState: fen });

    if (game) {
      io.to(gameId).emit("update-board", fen);
    }
  });

  socket.on("disconnect", () => {
    console.log("A player disconnected:", socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
