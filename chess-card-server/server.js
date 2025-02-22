require("dotenv").config();
const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

// Initialize Express
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Serve static files from "public" folder
app.use(express.static(path.join(__dirname, "public")));

// ------------------------------
// MongoDB Connection
// ------------------------------
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// ------------------------------
// Game Model (Add "gameCode" field)
const GameSchema = new mongoose.Schema({
  gameCode: { type: String, unique: true, sparse: true },
  boardState: { type: String, default: "start" },
  playerHands: {
    white: { type: Array, default: [] },
    black: { type: Array, default: [] }
  },
  turn: { type: String, default: "white" },
  messages: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});

const Game = mongoose.model("Game", GameSchema);

// ------------------------------
// POST /join-code
//   Body: { gameCode: string }
//   If a game with this code exists, return it. Otherwise create one.
// ------------------------------
app.post("/join-code", async (req, res) => {
  try {
    const { gameCode } = req.body;
    if (!gameCode) {
      return res.status(400).json({ error: "gameCode is required" });
    }
    let game = await Game.findOne({ gameCode });
    if (!game) {
      // Create new game doc
      game = new Game({
        gameCode,
        boardState: "start",
        turn: "white",
        messages: [`Game created with code: ${gameCode}`]
      });
      await game.save();
      console.log(`Created new game with code: ${gameCode}`);
    } else {
      console.log(`Found existing game with code: ${gameCode}`);
    }
    res.json(game);
  } catch (err) {
    console.error("Error in /join-code:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /game/:id -> return game doc
app.get("/game/:id", async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }
    res.json(game);
  } catch (err) {
    console.error("Error in /game/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

// Socket.io
io.on("connection", (socket) => {
  console.log("👤 Player connected:", socket.id);

  socket.on("join-game", async (gameId) => {
    if (!gameId) {
      console.error("join-game with no gameId");
      return;
    }
    socket.join(gameId);
    console.log(`📌 Player joined game: ${gameId}`);
  });

  socket.on("move-piece", async (data) => {
    const { gameId, fen } = data;
    try {
      // Update the boardState in Mongo
      const game = await Game.findByIdAndUpdate(gameId, { boardState: fen });
      if (game) {
        // Broadcast updated FEN to all in the room
        io.to(gameId).emit("update-board", fen);
      }
    } catch (err) {
      console.error("Error updating board state:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("🚪 Player disconnected:", socket.id);
  });
});


// Add this to your server.js (before starting the server)
let waitingGameId = null; // Global variable to hold a waiting game

app.get("/match", async (req, res) => {
  try {
    if (waitingGameId) {
      // Return the waiting game and mark it as active
      const game = await Game.findById(waitingGameId);
      if (game) {
        // Optionally update game status here
        waitingGameId = null;
        return res.json(game);
      }
    }
    // Otherwise, create a new game
    const newGame = new Game({
      boardState: "start",
      playerHands: { white: [], black: [] },
      turn: "white",
      messages: ["Game started."],
      // Optionally, set a game code or status if desired
    });
    await newGame.save();
    waitingGameId = newGame._id;
    res.json(newGame);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Health check
app.get("/", (req, res) => {
  res.send("✅ Chess server up!");
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
