require("dotenv").config();
const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const Chess = require("chess.js");

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
// Game Model
// ------------------------------
const GameSchema = new mongoose.Schema({
  gameCode: { type: String, default: () => Math.random().toString(36).substring(2, 8) },
  boardState: { type: String, default: "start" },
  playerHands: {
    white: { type: Array, default: [] },
    black: { type: Array, default: [] }
  },
  turn: { type: String, default: "white" },
  messages: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now },
  players: { type: Number, default: 0 }
});

const Game = mongoose.model("Game", GameSchema);

// ------------------------------
// Auto-Match Endpoint: GET /match
// If a waiting game exists, return it. Otherwise, create a new game.
// ------------------------------
let waitingGameId = null; // holds the _id of a waiting game

app.get("/match", async (req, res) => {
  try {
    if (waitingGameId) {
      const game = await Game.findById(waitingGameId);
      if (game && game.players < 2) {
        await Game.findByIdAndUpdate(waitingGameId, { players: game.players + 1 });
        waitingGameId = null;
        console.log("Found waiting game:", game._id);
        return res.json(game);
      }
    }
    
    const newGame = new Game({
      players: 1,
      messages: ["Game started (waiting for opponent)."]
    });
    await newGame.save();
    waitingGameId = newGame._id;
    console.log("Created new waiting game:", newGame._id);
    res.json(newGame);
  } catch (err) {
    console.error("Error in /match:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// GET /game/:id to return game state
// ------------------------------
app.get("/game/:id", async (req, res) => {
  try {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ error: "Game not found" });
    res.json(game);
  } catch (err) {
    console.error("Error in /game/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------
// Socket.io Integration
// ------------------------------
io.on("connection", (socket) => {
  console.log("👤 Player connected:", socket.id);

  socket.on("join-game", async (gameId) => {
    if (!gameId) {
      console.error("join-game received with no gameId");
      return;
    }
    
    try {
      const game = await Game.findById(gameId);
      if (!game) {
        socket.emit("error", "Game not found");
        return;
      }

      socket.join(gameId);
      
      // Assign player color based on order of joining
      const clients = await io.in(gameId).allSockets();
      socket.playerColor = clients.size === 1 ? 'white' : 'black';
      
      console.log(`📌 Player joined game: ${gameId} as ${socket.playerColor}`);
      
      // Update game with player count
      await Game.findByIdAndUpdate(gameId, { players: clients.size });
      
      if (clients.size >= 2) {
        io.to(gameId).emit("match-start", { 
          message: "Opponent joined! Game starting.",
          gameId: gameId
        });
      }
    } catch (err) {
      console.error("Error joining game:", err);
      socket.emit("error", "Failed to join game");
    }
  });

  socket.on("move-piece", async ({ gameId, fen }) => {
    try {
      const game = await Game.findById(gameId);
      if (!game) {
        socket.emit("error", "Game not found");
        return;
      }

      // Validate that it's the player's turn
      const chess = new Chess(game.boardState);
      const currentTurn = chess.turn() === 'w' ? 'white' : 'black';
      const playerColor = socket.playerColor; // You'll need to set this when player joins

      if (currentTurn !== playerColor) {
        socket.emit("error", "Not your turn");
        return;
      }

      // Update game state
      game.boardState = fen;
      await game.save();

      // Broadcast the move to all players in the room
      io.to(gameId).emit("update-board", fen);
    } catch (err) {
      console.error("Error processing move:", err);
      socket.emit("error", "Failed to process move");
    }
  });

  socket.on("disconnecting", async () => {
    try {
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          const clients = await io.in(room).allSockets();
          await Game.findByIdAndUpdate(room, { players: clients.size - 1 });
        }
      }
    } catch (err) {
      console.error("Error handling disconnect:", err);
    }
  });
});

// ------------------------------
// Health Check
// ------------------------------
app.get("/", (req, res) => {
  res.send("✅ Chess server up!");
});

// ------------------------------
// Start Server
// ------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
